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
import { readSettlementReceipt, confirmAuthorizationState, readBlockTimestamp, type ReceiptRead } from "./chain.js";
import { decodeSignedAuthorization, computePayloadBind, type SignedAuthorization, type PayloadBind } from "./authz.js";
import { computeResourceBinding, extractResourceUrl, type ResourceBinding } from "./resource.js";
import {
  readSolanaSettlement,
  computeSvmReconcile,
  isSolanaRail,
  isSolanaAddress,
  SOLANA_USDC_MINT,
  type SvmReconcileResult,
} from "./svm.js";

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
export { readSettlementReceipt, confirmAuthorizationState, readBlockTimestamp, DEFAULT_BASE_RPCS } from "./chain.js";
export type { ReceiptRead } from "./chain.js";
export { decodeSignedAuthorization, computePayloadBind } from "./authz.js";
export type { SignedAuthorization, PayloadBind, PayloadBindChecks } from "./authz.js";
export { computeResourceBinding, extractResourceUrl, resourceMatchesUrl } from "./resource.js";
export type { ResourceBinding } from "./resource.js";
export {
  readSolanaSettlement,
  computeSvmReconcile,
  decodeSvmUsdcDeltas,
  decodeSolanaMemos,
  svmFingerprint,
  solanaGetTransaction,
  isSolanaRail,
  isSolanaSignature,
  isSolanaAddress,
  SOLANA_USDC_MINT,
  SVM_USDC_DECIMALS,
  DEFAULT_SOLANA_RPCS,
} from "./svm.js";
export type { SvmReconcileResult, SvmUsdcDelta, SolanaRead } from "./svm.js";

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
  /**
   * Signed-payload binding (4-check standard, check #4 + the on-chain half of
   * #1) — the two checks only the payer can make. "bound" means the EIP-3009
   * nonce consumed on-chain is exactly the one THIS client signed, and it
   * settled inside its [validAfter, validBefore] window. "mismatch" /
   * "window-violation" are fail-closed forgery/anomaly signals. "unbound" = a
   * direct transfer with no nonce to bind; "no-payload" = reconcile-only path.
   * null on reconcile:"off" or an early-out before a settlement tx was read.
   */
  payloadBind: PayloadBind | null;
  /**
   * Cross-resource substitution binding (the 4th x402 flaw CLASS,
   * arXiv:2605.30998). x402's exact scheme signs (payer, payee, amount, window,
   * nonce) but NEVER the resource, so a settlement to the right payTo for the
   * right amount does not say WHICH resource it paid for — the same payment
   * reconcile-validates for any resource sharing that (payTo, amount). This
   * field binds the settlement to the resource THIS client actually fetched:
   *  - "DECLARED": the live 402 the requested url answered declares a `resource`
   *    matching that url (seller asserts the payment is for it);
   *  - "SUBSTITUTABLE": the 402 declared NO resource → nothing beyond payTo+amount
   *    ties the payment to a resource (substitution-exposed);
   *  - "RESOURCE_MISMATCH": the 402 declared a DIFFERENT resource (fail-closed);
   *  - "UNVERIFIED": no live 402 read (e.g. `expected` bound, probe off, POST).
   * Only the payer can bind this authoritatively: it holds the exact url fetched,
   * which a hosted verifier only ever gets as a self-reported parameter. null on
   * reconcile:"off" or before any settlement was read.
   */
  resourceBinding: ResourceBinding | null;
  /**
   * Which settlement rail this verdict was reconciled on. "evm" = Base-mainnet
   * USDC (the default). "svm" = Solana-mainnet SPL-USDC — reconciled by reading
   * the Solana chain directly (keyless public getTransaction, dual-RPC
   * cross-confirmed), so the wrapper never has to trust a Solana facilitator's
   * /verify (cf. GHSA-qr2g-p6q7-w82m). This makes it the only x402 fetch wrapper
   * that reconciles both rails on-chain.
   */
  rail: "evm" | "svm";
  /**
   * The full Solana reconcile detail when `rail === "svm"` (per-owner USDC
   * balance deltas, SPL memos, slot, block time, explorer link). null on the
   * EVM path. The EVM-shaped `matched`/`authorization`/`payloadBind` fields are
   * null on the SVM path (EIP-3009 is EVM-specific); read `svm` instead.
   */
  svm: SvmReconcileResult | null;
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
   * Solana-mainnet JSON-RPC URLs (up to 2 used, cross-confirmed) for the SVM
   * rail. Defaults to keyless public endpoints. Only consulted when the
   * settlement's PAYMENT-RESPONSE network is `solana:*`.
   */
  solanaRpcUrls?: string[];
  /**
   * How to treat a failed settlement (WRONG_RECIPIENT / UNDERPAID / REVERTED /
   * NO_TRANSFER). "annotate" (default) attaches the verdict and lets the
   * response through (degrade-open — never silently breaks a paying agent).
   * "throw" raises X402SettlementError so a strict agent can abort.
   */
  onMismatch?: "annotate" | "throw";
  /**
   * How to treat a cross-resource-substitution signal (the 4th flaw class):
   * `resourceBinding.verdict` of RESOURCE_MISMATCH (the live 402 declares a
   * DIFFERENT resource than the url you fetched) — and, when `strict`, also
   * SUBSTITUTABLE (the 402 declares no resource at all). "annotate" (default)
   * attaches the verdict and lets the response through (degrade-open). "throw"
   * raises X402SettlementError so a strict agent can refuse to use a response it
   * cannot attribute to the resource it meant to pay for. Independent of the
   * money-side `onMismatch` — the payment can settle perfectly yet be bound to
   * the wrong resource.
   */
  onResourceMismatch?: "annotate" | "throw" | "strict";
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
    // If the money verdict is fine but we threw on the resource binding, say so —
    // a strict agent aborting on a wrong/absent resource is a different failure
    // than an underpaid/wrong-recipient settlement.
    const rb = settlement.resourceBinding;
    const msg =
      settlement.settled && rb && (rb.verdict === "RESOURCE_MISMATCH" || rb.verdict === "SUBSTITUTABLE")
        ? `x402 resource binding ${rb.verdict}: ${rb.note}`
        : `x402 settlement ${settlement.verdict}: ${settlement.note}`;
    super(msg);
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

/** Read a request header off whichever of (init.headers, Request) carries it. */
function requestHeader(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | null {
  const lower = name.toLowerCase();
  try {
    if (init?.headers) {
      const h = new Headers(init.headers as HeadersInit);
      const v = h.get(lower);
      if (v) return v;
    }
  } catch {
    /* non-standard headers shape — fall through */
  }
  try {
    if (typeof input !== "string" && !(input instanceof URL)) {
      const v = (input as Request).headers?.get(lower);
      if (v) return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * The live-402 probe result: the advertised payTo+amount AND the resource
 * context the cross-resource-substitution binding reconciles against.
 * `challengeFetched` distinguishes "the url answered with an x402 402 we read"
 * from "no live 402" — the two produce different resource verdicts.
 */
interface Live402Probe {
  advertised: AdvertisedRequirement;
  challengeFetched: boolean;
  challengeResource: string | null;
  scheme: string | null;
}

/** Parse a live 402 body into the advertised requirement + resource context. */
async function resolveAdvertisedFrom402(
  targetUrl: string,
  method: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<Live402Probe> {
  const none: Live402Probe = {
    advertised: { payTo: null, amountAtomic: null, source: null },
    challengeFetched: false,
    challengeResource: null,
    scheme: null,
  };
  if (method !== "GET" && method !== "HEAD") return none; // never re-send a side-effecting request unpaid
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(targetUrl, { method: "GET", signal: ctl.signal });
    if (res.status !== 402) return none;
    const body = (await res.json()) as {
      resource?: unknown;
      accepts?: Array<{ payTo?: string; amount?: string; maxAmountRequired?: string; scheme?: string; resource?: unknown }>;
    };
    const a = body.accepts?.[0];
    // The declared `resource` identifier — x402 carries it as accepts[0].resource
    // OR as a top-level metadata object { url, ... } (Coinbase middleware shape).
    const challengeResource = extractResourceUrl(a?.resource ?? body.resource ?? null);
    const scheme = a?.scheme != null ? String(a.scheme).toLowerCase() : null;
    if (!a) return { ...none, challengeFetched: true, challengeResource, scheme };
    const amtRaw = a.amount ?? a.maxAmountRequired;
    const amountAtomic = amtRaw != null && amtRaw !== "" ? Number(amtRaw) : null;
    return {
      advertised: {
        payTo: a.payTo ?? null,
        amountAtomic: Number.isFinite(amountAtomic as number) ? (amountAtomic as number) : null,
        amountIsCap: scheme != null && scheme !== "exact",
        source: "live-402",
      },
      challengeFetched: true,
      challengeResource,
      scheme,
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
  const onResourceMismatch = options.onResourceMismatch ?? "annotate";
  const resolveMode = options.resolveAdvertised ?? "probe";
  const fetchImpl = options.fetchImpl ?? baseFetch;
  const timeoutMs = options.timeoutMs ?? 7000;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const targetUrl = urlOf(input);
    const method = methodOf(input, init);

    // Capture the X-PAYMENT header the official payer attaches on the paid retry
    // — this is the EIP-3009 authorization WE signed, held only by the payer.
    // Per-call capture (isolated under concurrency); the capturing fetch is only
    // used inside @x402/fetch's pay loop, never for the unpaid probe.
    let capturedXPayment: string | null = null;
    const capturingFetch: typeof globalThis.fetch = (ci: RequestInfo | URL, cinit?: RequestInit) => {
      const h = requestHeader(ci, cinit, "x-payment");
      if (h) capturedXPayment = h;
      return baseFetch(ci, cinit);
    };
    const payFetch = wrapFetchWithPayment(capturingFetch, client);

    // Pre-resolve the advertised requirement (so we can detect WRONG_RECIPIENT),
    // unless the caller bound it or disabled reconcile.
    let advertised: AdvertisedRequirement = { payTo: null, amountAtomic: null, source: null };
    // Resource context for the cross-resource-substitution binding (4th flaw
    // class). Captured from the SAME probe that reads the advertised payTo+amount;
    // when the caller bound `expected` (or probing is off), no live 402 is read,
    // so the binding honestly reports UNVERIFIED.
    let challengeFetched = false;
    let challengeResource: string | null = null;
    let challengeScheme: string | null = null;
    if (reconcileMode === "local") {
      if (options.expected?.payTo) {
        advertised = {
          payTo: options.expected.payTo,
          amountAtomic: usdcToAtomic(options.expected.amountUsdc ?? null),
          amountIsCap: options.expected.amountIsCap ?? false,
          source: "caller",
        };
      } else if (resolveMode === "probe") {
        const probe = await resolveAdvertisedFrom402(targetUrl, method, fetchImpl, timeoutMs);
        advertised = probe.advertised;
        challengeFetched = probe.challengeFetched;
        challengeResource = probe.challengeResource;
        challengeScheme = probe.scheme;
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

    // The signed EIP-3009 authorization we sent (payer-only; decoded from the
    // captured X-PAYMENT header). Drives check #4 + the signed-payload bind.
    const signed: SignedAuthorization | null = decodeSignedAuthorization(capturedXPayment);

    let read: ReceiptRead = { found: false, status: null, transfers: [], authEvents: [], block: null, confirmation: "not-found", sources: [] };
    let core: ReconcileResult;
    let authorization: AuthorizationProof | null = null;
    let payloadBind: PayloadBind | null = null;
    let rail: "evm" | "svm" = "evm";
    let svm: SvmReconcileResult | null = null;
    if (!tx) {
      core = {
        verdict: "UNVERIFIED",
        settled: false,
        matched: null,
        note: "the server returned a PAYMENT-RESPONSE header but no settlement tx hash could be decoded from it",
      };
    } else if (isSolanaRail(network, tx)) {
      // ── Cross-rail: Solana (SVM) settlement. Read the Solana chain directly
      // (keyless getTransaction, dual-RPC cross-confirmed) and reconcile the
      // per-owner USDC balance delta against the advertised payTo+amount. No
      // EIP-3009 authorization / payloadBind on this rail (EVM-specific) → those
      // stay null and the detail lives in `svm`. The payTo must be a Solana
      // owner to bind; otherwise UNVERIFIED-by-construction (never a false proof).
      rail = "svm";
      const svmPayTo = advertised.payTo && isSolanaAddress(advertised.payTo) ? advertised.payTo : null;
      const sread = await readSolanaSettlement(tx, {
        rpcUrls: options.solanaRpcUrls,
        fetchImpl,
        timeoutMs,
        mint: SOLANA_USDC_MINT,
      });
      svm = computeSvmReconcile({
        signature: tx,
        network: network ?? "solana:mainnet",
        txJson: sread.txJson,
        payToOwner: svmPayTo,
        expectAtomic: advertised.amountAtomic,
        advertisedSource: advertised.source,
        confirmation: sread.confirmation,
        sources: sread.sources,
      });
      core = { verdict: svm.verdict, settled: svm.settled, matched: null, note: svm.note };
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

        // 4-check standard: check #4 (validity window) + the signed-payload bind
        // (the on-chain half of check #1) — the two checks ONLY the payer can
        // make, because only this client holds the authorization it signed. Read
        // the settlement block's timestamp (cross-confirmed) and bind the signed
        // nonce / recipient / amount to the consumed on-chain authorization.
        const consumedNonce = authorization.status === "consumed" ? authorization.nonce : null;
        let blockTime: number | null = null;
        let blockConf: PayloadBind["confirmation"] = "n/a";
        if (signed && read.block != null) {
          const bt = await readBlockTimestamp(read.block, { rpcUrls: options.rpcUrls, fetchImpl, timeoutMs });
          blockTime = bt.timestamp;
          blockConf = bt.confirmation === "not-found" ? "n/a" : bt.confirmation;
        }
        payloadBind = computePayloadBind(
          signed,
          core.matched?.to ?? advertised.payTo ?? null,
          core.matched?.amount_atomic ?? null,
          consumedNonce,
          blockTime,
          blockConf,
        );

        // Fail closed on a payer-side forgery/anomaly signal:
        //  - "mismatch": the consumed nonce is NOT the one we signed (the nonce
        //    comes from the already dual-confirmed receipt, so no extra trust).
        //  - "window-violation": the settlement mined outside the signed validity
        //    window, confirmed by a dual-confirmed block-time read.
        if (core.settled && payloadBind.status === "mismatch") {
          core = {
            verdict: "UNVERIFIED",
            settled: false,
            matched: core.matched,
            note: `${core.note} — BUT ${payloadBind.note}. Failing closed: the on-chain settlement is not of the authorization this client signed.`,
          };
        } else if (core.settled && payloadBind.status === "window-violation" && payloadBind.confirmation === "dual-confirmed") {
          core = {
            verdict: "UNVERIFIED",
            settled: false,
            matched: core.matched,
            note: `${core.note} — BUT ${payloadBind.note}. Failing closed: the settlement did not occur within the authorized validity window.`,
          };
        } else if (payloadBind.status === "bound") {
          core = {
            ...core,
            note: `${core.note}; signed-payload bound (the EIP-3009 nonce consumed on-chain is exactly the one this client signed${payloadBind.checks.windowOk === true ? ", settled within the authorized validity window" : ""})`,
          };
        }
      }
    }

    // 4th x402 flaw class: cross-resource substitution. Bind the settlement to
    // the resource THIS client actually fetched. nonceConsumed comes from check
    // #2 (consumed EIP-3009 authorization) — post-spend the on-chain payment is
    // singular. Only the payer can run this honestly: `targetUrl` is the exact
    // url the agent requested, not a self-reported parameter a hosted verifier
    // would receive. Not gated on a settled verdict — a mismatch/substitutable
    // resource is worth surfacing regardless of the money verdict.
    const nonceConsumed =
      authorization == null ? null : authorization.status === "consumed" ? true : authorization.status === "state-mismatch" ? false : null;
    const resourceBinding: ResourceBinding = computeResourceBinding(
      targetUrl,
      challengeFetched,
      challengeResource,
      challengeScheme,
      nonceConsumed,
    );

    const settlement: VerifiedSettlement = {
      verdict: core.verdict,
      settled: core.settled,
      tx,
      network,
      payer,
      block: read.block,
      confirmation: svm ? svm.confirmation : read.confirmation,
      rpcSources: svm ? svm.sources : read.sources,
      advertised,
      matched: core.matched,
      authorization,
      payloadBind,
      resourceBinding,
      rail,
      svm,
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
    // 4th flaw class: let a strict agent refuse a response it cannot attribute to
    // the resource it paid for. RESOURCE_MISMATCH always throws under "throw"/"strict";
    // the softer SUBSTITUTABLE (no resource declared) throws only under "strict".
    if (onResourceMismatch !== "annotate") {
      const rbVerdict = resourceBinding.verdict;
      if (rbVerdict === "RESOURCE_MISMATCH" || (onResourceMismatch === "strict" && rbVerdict === "SUBSTITUTABLE")) {
        throw new X402SettlementError(settlement, out);
      }
    }
    return out;
  };
}

export default wrapFetchWithVerifiedPayment;
