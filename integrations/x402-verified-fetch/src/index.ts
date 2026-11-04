/**
 * @grey-ridge/x402-verified-fetch
 *
 * A drop-in fetch wrapper for x402-paying agents that adds the one thing every
 * other x402 wrapper is missing: an INDEPENDENT on-chain reconcile of the
 * payment the endpoint claims settled.
 *
 * It composes @x402/fetch's `wrapFetchWithPayment` (the official Coinbase payer
 * client) with a post-payment check: it decodes the `PAYMENT-RESPONSE` header
 * the server returns after settlement, reads that Base tx's receipt directly
 * from the chain (two independent public RPCs, cross-confirmed), decodes the
 * USDC Transfer events, and reconciles them against the payTo + amount the
 * endpoint advertised in its 402 — returning a verdict of
 * SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND.
 *
 * Every rival wrapper stops at the pre-payment 402 (conformance / budget cap /
 * header linkage). None reads the chain. This one does.
 *
 * Honesty (Claims Law): this confirms on-chain settlement to the right address
 * for the right amount. It does not guarantee the off-chain resource was
 * delivered or that its content is correct.
 */

import { wrapFetchWithPayment } from "@x402/fetch";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { x402Client, x402HTTPClient } from "@x402/core/client";

import {
  reconcileSettlement,
  computeAuthorizationProof,
  usdcToAtomic,
  type ReconcileResult,
  type SettlementVerdict,
  type ReceiptTransfer,
  type AuthorizationProof,
} from "./reconcile.js";
import { readSettlementReceipt, confirmAuthorizationState, type ReceiptRead } from "./chain.js";

export {
  reconcileSettlement,
  decodeUsdcTransfers,
  decodeAuthorizationUsed,
  computeAuthorizationProof,
  authorizationStateCallData,
  decodeAuthorizationStateResult,
  usdcToAtomic,
  atomicToUsdcStr,
  receiptStatus,
  USDC_BASE,
  USDC_DECIMALS,
  USDC_TRANSFER_TOPIC,
  USDC_AUTH_USED_TOPIC,
  USDC_AUTH_STATE_SELECTOR,
} from "./reconcile.js";
export type { ReconcileResult, SettlementVerdict, ReceiptTransfer, AuthorizationProof, AuthorizationUsedEvent } from "./reconcile.js";
export { readSettlementReceipt, confirmAuthorizationState, DEFAULT_BASE_RPCS } from "./chain.js";
export type { ReceiptRead } from "./chain.js";

/** The advertised requirement a buyer pays against (payTo + amount). */
export interface AdvertisedRequirement {
  payTo: string | null;
  amountAtomic: number | null;
  /** true for non-exact schemes (upto/batch) where the amount is a ceiling. */
  amountIsCap?: boolean;
  source: "caller" | "live-402" | null;
}

/** The full settlement verdict attached to a verified response. */
export interface VerifiedSettlement {
  verdict: SettlementVerdict;
  settled: boolean;
  tx: string | null;
  network: string | null;
  payer: string | null;
  block: number | null;
  confirmation: ReceiptRead["confirmation"];
  rpcSources: string[];
  advertised: AdvertisedRequirement;
  matched: ReceiptTransfer | null;
  /**
   * EIP-3009 authorization proof (4-check standard, check #2). "consumed" binds
   * the settlement to a spent USDC transfer authorization — catching a replayed
   * / unrelated Transfer to the same payTo that a Transfer-amount match alone
   * cannot. "state-mismatch" (dual-confirmed) is a forgery signal we fail closed
   * on. "not-eip3009" = a direct transfer (reconcile still stands, nothing to
   * bind). null on reconcile:"off" or an UNVERIFIED/NOT_FOUND early-out.
   */
  authorization: AuthorizationProof | null;
  note: string;
}

export interface VerifiedFetchOptions {
  /**
   * "local" (default) reads the Base chain directly over public RPC — free,
   * independent, no account. "off" skips reconcile (pass-through payer only).
   */
  reconcile?: "local" | "off";
  /** Base-mainnet JSON-RPC URLs (up to 2 used, cross-confirmed). */
  rpcUrls?: string[];
  /**
   * How to treat a failed settlement (WRONG_RECIPIENT / UNDERPAID / REVERTED /
   * NO_TRANSFER). "annotate" (default) attaches the verdict and lets the
   * response through (degrade-open — never silently breaks a paying agent).
   * "throw" raises X402SettlementError so a strict agent can abort.
   */
  onMismatch?: "annotate" | "throw";
  /**
   * Resolve the advertised payTo+amount. "probe" (default) sends one unpaid GET
   * to capture the endpoint's live 402; pass `expected` to skip the probe
   * (required for POST/side-effecting endpoints).
   */
  resolveAdvertised?: "probe" | "off";
  /** Bind the reconcile directly, skipping the probe. */
  expected?: { payTo?: string; amountUsdc?: string | number; amountIsCap?: boolean };
  /** Called with the verdict after every settled request. */
  onSettlement?: (s: VerifiedSettlement) => void;
  /** fetch used for the unpaid probe + RPC reads (defaults to the wrapped fetch's base). */
  fetchImpl?: typeof globalThis.fetch;
  /** RPC timeout per provider (ms). Default 7000. */
  timeoutMs?: number;
}

/** Thrown when onMismatch:"throw" and the settlement did not verify. */
export class X402SettlementError extends Error {
  readonly settlement: VerifiedSettlement;
  readonly response: Response;
  constructor(settlement: VerifiedSettlement, response: Response) {
    super(`x402 settlement ${settlement.verdict}: ${settlement.note}`);
    this.name = "X402SettlementError";
    this.settlement = settlement;
    this.response = response;
  }
}

/** The header our wrapper writes the verdict JSON into on every verified response. */
export const SETTLEMENT_HEADER = "x-grs-settlement";

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}
function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL)) return (input as Request).method.toUpperCase();
  return "GET";
}

/** Parse the first `accepts[]` entry from a live 402 body into an advertised requirement. */
async function resolveAdvertisedFrom402(
  targetUrl: string,
  method: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<AdvertisedRequirement> {
  const none: AdvertisedRequirement = { payTo: null, amountAtomic: null, source: null };
  if (method !== "GET" && method !== "HEAD") return none; // never re-send a side-effecting request unpaid
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(targetUrl, { method: "GET", signal: ctl.signal });
    if (res.status !== 402) return none;
    const body = (await res.json()) as {
      accepts?: Array<{ payTo?: string; amount?: string; maxAmountRequired?: string; scheme?: string }>;
    };
    const a = body.accepts?.[0];
    if (!a) return none;
    const amtRaw = a.amount ?? a.maxAmountRequired;
    const amountAtomic = amtRaw != null && amtRaw !== "" ? Number(amtRaw) : null;
    return {
      payTo: a.payTo ?? null,
      amountAtomic: Number.isFinite(amountAtomic as number) ? (amountAtomic as number) : null,
      amountIsCap: a.scheme != null && a.scheme !== "exact",
      source: "live-402",
    };
  } catch {
    return none;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Wrap a fetch with x402 payment (via @x402/fetch) PLUS independent on-chain
 * settlement reconcile. Drop-in: same signature as `wrapFetchWithPayment`, with
 * an extra options object.
 *
 * @example
 * ```ts
 * import { wrapFetchWithVerifiedPayment } from "@grey-ridge/x402-verified-fetch";
 * import { x402Client } from "@x402/fetch";
 * import { ExactEvmScheme } from "@x402/evm";
 *
 * const client = new x402Client().register("eip155:8453", new ExactEvmScheme(signer));
 * const fetchVerified = wrapFetchWithVerifiedPayment(fetch, client, {
 *   onMismatch: "throw",
 *   onSettlement: (s) => console.log(s.verdict, s.tx),
 * });
 *
 * const res = await fetchVerified("https://seller.example/x402/data");
 * // res.headers.get("x-grs-settlement") -> verdict JSON
 * ```
 */
export function wrapFetchWithVerifiedPayment(
  baseFetch: typeof globalThis.fetch,
  client: x402Client | x402HTTPClient,
  options: VerifiedFetchOptions = {},
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const reconcileMode = options.reconcile ?? "local";
  const onMismatch = options.onMismatch ?? "annotate";
  const resolveMode = options.resolveAdvertised ?? "probe";
  const fetchImpl = options.fetchImpl ?? baseFetch;
  const timeoutMs = options.timeoutMs ?? 7000;
  const payFetch = wrapFetchWithPayment(baseFetch, client);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const targetUrl = urlOf(input);
    const method = methodOf(input, init);

    // Pre-resolve the advertised requirement (so we can detect WRONG_RECIPIENT),
    // unless the caller bound it or disabled reconcile.
    let advertised: AdvertisedRequirement = { payTo: null, amountAtomic: null, source: null };
    if (reconcileMode === "local") {
      if (options.expected?.payTo) {
        advertised = {
          payTo: options.expected.payTo,
          amountAtomic: usdcToAtomic(options.expected.amountUsdc ?? null),
          amountIsCap: options.expected.amountIsCap ?? false,
          source: "caller",
        };
      } else if (resolveMode === "probe") {
        advertised = await resolveAdvertisedFrom402(targetUrl, method, fetchImpl, timeoutMs);
      }
    }

    // Pay via the official x402 client.
    const res = await payFetch(input, init);

    if (reconcileMode === "off") return res;

    // Only settled (non-402) responses carry a PAYMENT-RESPONSE header.
    const payHeader = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    if (!payHeader) return res;

    let tx: string | null = null;
    let network: string | null = null;
    let payer: string | null = null;
    let amountFromHeader: number | null = null;
    try {
      const settle = decodePaymentResponseHeader(payHeader) as {
        transaction?: string;
        network?: string;
        payer?: string;
        amount?: string;
      };
      tx = settle.transaction ?? null;
      network = settle.network ?? null;
      payer = settle.payer ?? null;
      amountFromHeader = settle.amount != null && settle.amount !== "" ? Number(settle.amount) : null;
    } catch {
      /* unparseable header — leave nulls, verdict UNVERIFIED below */
    }

    let read: ReceiptRead = { found: false, status: null, transfers: [], authEvents: [], block: null, confirmation: "not-found", sources: [] };
    let core: ReconcileResult;
    let authorization: AuthorizationProof | null = null;
    if (!tx) {
      core = {
        verdict: "UNVERIFIED",
        settled: false,
        matched: null,
        note: "the server returned a PAYMENT-RESPONSE header but no settlement tx hash could be decoded from it",
      };
    } else {
      read = await readSettlementReceipt(tx, { rpcUrls: options.rpcUrls, fetchImpl, timeoutMs });
      if (read.confirmation === "rpc-disagreement") {
        core = {
          verdict: "UNVERIFIED",
          settled: false,
          matched: null,
          note: "two independent Base RPCs disagreed on this tx's receipt — failing closed rather than trusting a single source",
        };
      } else {
        core = reconcileSettlement(read.status, read.transfers, advertised.payTo, advertised.amountAtomic, undefined, advertised.amountIsCap ?? false);

        // 4-check standard, check #2: bind the settlement to a CONSUMED EIP-3009
        // authorization nonce. A Transfer-amount match (check #3) cannot catch a
        // tx that points at a replayed / unrelated USDC transfer to the same
        // payTo — this can. Keyless: one extra cross-confirmed USDC eth_call.
        if (read.authEvents.length === 0) {
          authorization = computeAuthorizationProof([], core.matched?.from ?? null, null);
        } else {
          const matchedFrom = core.matched?.from ?? null;
          const chosen =
            (matchedFrom && read.authEvents.find((e) => e.authorizer.toLowerCase() === matchedFrom.toLowerCase())) ||
            read.authEvents[0];
          const st = await confirmAuthorizationState(chosen.authorizer, chosen.nonce, { rpcUrls: options.rpcUrls, fetchImpl, timeoutMs });
          authorization = computeAuthorizationProof(read.authEvents, matchedFrom, st.consumed, st.confirmation);
        }

        // Forgery fail-closed: a dual-confirmed state-mismatch means two
        // independent providers confirm the nonce is NOT consumed, so a would-be
        // SETTLED is not a genuine settlement of this payment.
        if (authorization.status === "state-mismatch" && authorization.confirmation === "dual-confirmed" && core.settled) {
          core = {
            verdict: "UNVERIFIED",
            settled: false,
            matched: core.matched,
            note: `${core.note} — BUT ${authorization.note}. Failing closed: the Transfer amount matched, yet the EIP-3009 authorization is not consumed on-chain, so this tx does not prove a genuine settlement of this payment.`,
          };
        } else if (authorization.status === "consumed") {
          core = {
            ...core,
            note: `${core.note}; EIP-3009 authorization consumed on-chain (nonce cross-confirmed), binding this settlement to a spent transfer authorization`,
          };
        }
      }
    }

    const settlement: VerifiedSettlement = {
      verdict: core.verdict,
      settled: core.settled,
      tx,
      network,
      payer,
      block: read.block,
      confirmation: read.confirmation,
      rpcSources: read.sources,
      advertised,
      matched: core.matched,
      authorization,
      note: core.note,
    };
    // keep a trace of the header-claimed amount for callers who want it
    void amountFromHeader;

    try {
      options.onSettlement?.(settlement);
    } catch {
      /* caller callback must never break the request */
    }

    // Attach the verdict so downstream code can read it off the response.
    // HTTP header values must be ASCII ByteStrings; our notes can carry
    // non-ASCII typography (em-dash). Escape any non-ASCII to its \uXXXX form —
    // still valid JSON, and JSON.parse decodes it back losslessly.
    const out = new Response(res.body, res);
    try {
      const asciiJson = JSON.stringify(settlement).replace(
        /[^\x00-\x7F]/g,
        (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
      );
      out.headers.set(SETTLEMENT_HEADER, asciiJson);
    } catch {
      /* some runtimes freeze headers on certain responses — non-fatal */
    }

    if (onMismatch === "throw" && !core.settled && core.verdict !== "UNVERIFIED" && core.verdict !== "NOT_FOUND") {
      throw new X402SettlementError(settlement, out);
    }
    return out;
  };
}

export default wrapFetchWithVerifiedPayment;
