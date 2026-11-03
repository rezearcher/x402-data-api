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
