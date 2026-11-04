/**
 * Independent on-chain settlement reconcile — the primitive no other x402 fetch
 * wrapper has. Pure, dependency-free, I/O-free: given a Base tx's status and its
 * decoded USDC Transfers plus the endpoint's advertised payTo + amount, decide
 * whether the payment actually settled to the right address for the right amount.
 *
 * This is a faithful port of the verdict core that powers Grey Ridge's hosted
 * /x402/receipt-verify, so a local reconcile agrees with the hosted one.
 */

/** Base-mainnet USDC (6 decimals). */
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDC_DECIMALS = 6;
/** keccak256("Transfer(address,address,uint256)") */
export const USDC_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type SettlementVerdict =
  | "SETTLED"
  | "UNDERPAID"
  | "WRONG_RECIPIENT"
  | "NO_TRANSFER"
  | "REVERTED"
  | "NOT_FOUND"
  | "UNVERIFIED";

export interface ReceiptTransfer {
  token: string;
  from: string;
  to: string;
  amount_atomic: number;
  amount_usdc: string;
}

export interface ReconcileResult {
  verdict: SettlementVerdict;
  settled: boolean;
  matched: ReceiptTransfer | null;
  note: string;
}

/** atomic USDC -> dollar string, degrade-open. */
export function atomicToUsdcStr(atomic: number, decimals = USDC_DECIMALS): string {
  if (!Number.isFinite(atomic)) return String(atomic);
  const s = (atomic / 10 ** decimals).toFixed(decimals);
  return s.replace(/\.?0+$/, "") || "0";
}

/** USDC dollar string/number -> atomic units (null if unparseable). */
export function usdcToAtomic(usdc: string | number | null | undefined, decimals = USDC_DECIMALS): number | null {
  if (usdc === null || usdc === undefined || usdc === "") return null;
  const n = typeof usdc === "number" ? usdc : Number(usdc);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10 ** decimals);
}

/**
 * Decode USDC Transfer events out of a Base tx receipt's logs. Degrade-open: a
 * malformed log is skipped, never thrown. `logs` is the raw `receipt.logs` array
 * from an eth_getTransactionReceipt response (topics[] + data hex).
 */
export function decodeUsdcTransfers(
  logs: unknown[],
  token = USDC_BASE,
  decimals = USDC_DECIMALS,
): ReceiptTransfer[] {
  const tok = token.toLowerCase();
  const out: ReceiptTransfer[] = [];
  for (const raw of logs ?? []) {
    try {
      const lg = raw as { address?: string; topics?: string[]; data?: string };
      if (String(lg.address ?? "").toLowerCase() !== tok) continue;
      const topics = lg.topics ?? [];
      if ((topics[0] ?? "").toLowerCase() !== USDC_TRANSFER_TOPIC) continue;
      if (topics.length < 3) continue;
      const from = "0x" + String(topics[1]).slice(26);
      const to = "0x" + String(topics[2]).slice(26);
      const atomic = Number(BigInt(lg.data && lg.data !== "0x" ? lg.data : "0x0"));
      if (!Number.isFinite(atomic)) continue;
      out.push({ token: tok, from, to, amount_atomic: atomic, amount_usdc: atomicToUsdcStr(atomic, decimals) });
    } catch {
      /* skip malformed log */
    }
  }
  return out;
}

/**
 * Pure verdict core. `txStatus`: "success" | "reverted" | "unknown" | null
 * (null => no receipt found). `advertisedAtomic` null => amount not checked.
 * `amountIsCap` true for non-exact schemes (upto/batch) where the advertised
 * amount is a ceiling, so a smaller settled amount is legitimate.
 */
export function reconcileSettlement(
  txStatus: "success" | "reverted" | "unknown" | null,
  usdcTransfers: ReceiptTransfer[],
  advertisedPayTo: string | null,
  advertisedAtomic: number | null,
  decimals = USDC_DECIMALS,
  amountIsCap = false,
): ReconcileResult {
  if (txStatus === null) {
    return {
      verdict: "NOT_FOUND",
      settled: false,
      matched: null,
      note: "no transaction receipt for this hash on Base mainnet — the tx is unknown, not yet mined, or on a different chain; nothing to verify",
    };
  }
  if (txStatus === "reverted") {
    return {
      verdict: "REVERTED",
      settled: false,
      matched: null,
      note: "the transaction reverted on-chain — no payment moved, so nothing settled regardless of the advertised recipient",
    };
  }
  if (!advertisedPayTo) {
    return {
      verdict: "UNVERIFIED",
      settled: false,
      matched: null,
      note: usdcTransfers.length
        ? `found ${usdcTransfers.length} USDC transfer(s) in this tx but no advertised payTo to reconcile against — pass expected.payTo or let the wrapper resolve it from the endpoint's live 402`
        : "no advertised payTo to reconcile against and no USDC transfer decoded",
    };
  }
  const want = advertisedPayTo.toLowerCase();
  const toPayTo = usdcTransfers.filter((t) => t.to.toLowerCase() === want);
  if (toPayTo.length === 0) {
    const others = [...new Set(usdcTransfers.map((t) => t.to))].slice(0, 3).join(", ");
    return {
      verdict: usdcTransfers.length ? "WRONG_RECIPIENT" : "NO_TRANSFER",
      settled: false,
      matched: null,
      note: usdcTransfers.length
        ? `this tx moved USDC but NONE to the advertised payTo ${advertisedPayTo} — the receipt does not prove payment to this endpoint (recipients in tx: ${others})`
        : `this tx contains no USDC Transfer to ${advertisedPayTo} — it is not a USDC settlement to this endpoint`,
    };
  }
  const paidAtomic = toPayTo.reduce((s, t) => s + t.amount_atomic, 0);
  const best = toPayTo.reduce((a, b) => (b.amount_atomic > a.amount_atomic ? b : a));
  const matched: ReceiptTransfer = {
    ...best,
    amount_atomic: paidAtomic,
    amount_usdc: atomicToUsdcStr(paidAtomic, decimals),
  };
  if (advertisedAtomic === null) {
    return {
      verdict: "SETTLED",
      settled: true,
      matched,
      note: `confirmed on-chain: ${matched.amount_usdc} USDC settled to the advertised payTo ${advertisedPayTo} (no advertised amount supplied, so the amount was not checked)`,
    };
  }
  const tol = Math.max(1, Math.round(advertisedAtomic * 0.01));
  if (amountIsCap && paidAtomic > 0) {
    return {
      verdict: "SETTLED",
      settled: true,
      matched,
      note: `confirmed on-chain: ${matched.amount_usdc} USDC settled to the advertised payTo ${advertisedPayTo}; non-exact scheme, so the advertised ${atomicToUsdcStr(advertisedAtomic, decimals)} USDC is a ceiling${paidAtomic > advertisedAtomic + tol ? " (note: settled amount EXCEEDS the advertised ceiling)" : ""}`,
    };
  }
  if (paidAtomic + tol < advertisedAtomic) {
    return {
      verdict: "UNDERPAID",
      settled: false,
      matched,
      note: `the advertised payTo received only ${matched.amount_usdc} USDC but the endpoint advertises ${atomicToUsdcStr(advertisedAtomic, decimals)} — the settlement is short`,
    };
  }
  return {
    verdict: "SETTLED",
    settled: true,
    matched,
    note: `confirmed on-chain: ${matched.amount_usdc} USDC settled to the advertised payTo ${advertisedPayTo} (>= the advertised ${atomicToUsdcStr(advertisedAtomic, decimals)} USDC)`,
  };
}

/** Map a raw receipt `status` hex ("0x1"/"0x0") to our status enum. */
export function receiptStatus(statusHex: unknown): "success" | "reverted" | "unknown" {
  return statusHex === "0x1" ? "success" : statusHex === "0x0" ? "reverted" : "unknown";
}

/* ---------------------------------------------------------------------------
 * EIP-3009 authorization proof — the 4-check on-chain standard's check #2.
 *
 * An x402 payment settled via transferWithAuthorization / receiveWithAuthorization
 * makes the USDC contract emit AuthorizationUsed(authorizer, nonce) and flip
 * authorizationState(authorizer, nonce) -> true. Reconciling the Transfer amount
 * (check #3, above) proves "a USDC transfer to the payTo for the right amount
 * exists in this tx" — but it CANNOT catch a &tx (or PAYMENT-RESPONSE header)
 * that points at an unrelated / replayed USDC transfer which happens to hit the
 * same payTo for the same amount. Binding the settlement to a CONSUMED EIP-3009
 * authorization nonce closes that forgery. This is the primitive the hosted
 * Grey Ridge /x402/receipt-verify makes, ported faithfully so a local wrapper
 * verdict agrees with the hosted one. Keyless: one extra USDC-contract eth_call.
 *
 * The two keccak constants are protocol constants self-validated against the
 * known Transfer topic (see scripts/keccak_check.py in the monorepo), not a
 * guessed list.
 * ------------------------------------------------------------------------- */

/** keccak256("AuthorizationUsed(address,bytes32)") */
export const USDC_AUTH_USED_TOPIC =
  "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
/** selector for authorizationState(address,bytes32) */
export const USDC_AUTH_STATE_SELECTOR = "0xe94a0102";

export interface AuthorizationUsedEvent {
  authorizer: string;
  nonce: string;
}

export interface AuthorizationProof {
  status: "consumed" | "state-mismatch" | "not-eip3009" | "unverified";
  authorizer: string | null;
  nonce: string | null;
  events: number;
  confirmation: "dual-confirmed" | "single-source" | "rpc-disagreement" | "n/a";
  note: string;
}

/**
 * Decode USDC AuthorizationUsed(authorizer, nonce) events out of a receipt's
 * logs. Degrade-open: a malformed log is skipped, never thrown.
 */
export function decodeAuthorizationUsed(
  logs: unknown[],
  token = USDC_BASE,
): AuthorizationUsedEvent[] {
  const tok = token.toLowerCase();
  const out: AuthorizationUsedEvent[] = [];
  for (const raw of logs ?? []) {
    try {
      const lg = raw as { address?: string; topics?: string[] };
      if (String(lg.address ?? "").toLowerCase() !== tok) continue;
      const topics = lg.topics ?? [];
      if ((topics[0] ?? "").toLowerCase() !== USDC_AUTH_USED_TOPIC) continue;
      if (topics.length < 3) continue;
      const authorizer = "0x" + String(topics[1]).slice(26).toLowerCase();
      const nonce = String(topics[2]).toLowerCase();
      out.push({ authorizer, nonce });
    } catch {
      /* skip malformed log */
    }
  }
  return out;
}

/**
 * Pure verdict core (no I/O). Given the AuthorizationUsed events decoded from a
 * receipt, the `from` of the reconciled Transfer, and the result of the live
 * USDC authorizationState eth_call for the chosen (authorizer, nonce):
 *   stateConsumed: true  -> contract confirms the nonce is consumed
 *   stateConsumed: false -> contract says NOT consumed (anomaly vs the log)
 *   stateConsumed: null  -> could not read the contract state
 */
export function computeAuthorizationProof(
  authEvents: AuthorizationUsedEvent[],
  matchedFrom: string | null,
  stateConsumed: boolean | null,
  stateConfirmation: AuthorizationProof["confirmation"] = "n/a",
): AuthorizationProof {
  if (!authEvents || authEvents.length === 0) {
    return {
      status: "not-eip3009",
      authorizer: null,
      nonce: null,
      events: 0,
      confirmation: "n/a",
      note: "this tx emitted no USDC AuthorizationUsed event — it did not settle via an EIP-3009 transfer authorization (e.g. a direct ERC-20 transfer); the Transfer-amount reconciliation still stands but there is no authorization nonce to bind it to",
    };
  }
  const want = matchedFrom ? matchedFrom.toLowerCase() : null;
  const chosen = (want && authEvents.find((e) => e.authorizer.toLowerCase() === want)) || authEvents[0];
  const b = { authorizer: chosen.authorizer, nonce: chosen.nonce, events: authEvents.length };
  if (stateConfirmation === "rpc-disagreement") {
    return {
      status: "unverified",
      ...b,
      confirmation: "rpc-disagreement",
      note: `two independent Base RPC providers disagreed on USDC authorizationState(${chosen.authorizer}, nonce) — could not confirm the authorization was consumed; not treated as proven`,
    };
  }
  if (stateConsumed === null) {
    return {
      status: "unverified",
      ...b,
      confirmation: stateConfirmation,
      note: `could not read USDC authorizationState(${chosen.authorizer}, nonce) from Base mainnet — the AuthorizationUsed log is present but not yet cross-confirmed against live contract state`,
    };
  }
  if (stateConsumed === true) {
    return {
      status: "consumed",
      ...b,
      confirmation: stateConfirmation,
      note: `EIP-3009 authorization CONSUMED: USDC authorizationState(${chosen.authorizer}, nonce) is true on Base mainnet, cross-confirming the receipt's AuthorizationUsed log against live contract state — this settlement is cryptographically bound to a spent transfer authorization, not just a matching Transfer amount`,
    };
  }
  return {
    status: "state-mismatch",
    ...b,
    confirmation: stateConfirmation,
    note: `FORGERY SIGNAL: the receipt carries an AuthorizationUsed log for authorizer ${chosen.authorizer}, yet USDC authorizationState(${chosen.authorizer}, nonce) reads NOT consumed on Base mainnet — the receipt does not reconcile with live contract state (possible fabricated log, replayed receipt, or wrong chain)`,
  };
}

/** Build the authorizationState(address,bytes32) eth_call data for a (authorizer, nonce). */
export function authorizationStateCallData(authorizer: string, nonce: string): string {
  const a = authorizer.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const n = nonce.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return USDC_AUTH_STATE_SELECTOR + a + n;
}

/** Decode an authorizationState eth_call result hex into consumed/not/null. */
export function decodeAuthorizationStateResult(res: unknown): boolean | null {
  if (typeof res !== "string" || !res.startsWith("0x") || res.length < 3) return null;
  try {
    return BigInt(res) !== 0n;
  } catch {
    return null;
  }
}
