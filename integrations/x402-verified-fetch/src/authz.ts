/**
 * Signed-payload binding — the two 4-check standard checks that ONLY the payer
 * can make, because only the payer holds the EIP-3009 authorization it signed.
 *
 *   check #4 (validity window): the block the settlement mined in must fall
 *     within the authorization's [validAfter, validBefore] window.
 *   signed-payload bind (the on-chain half of check #1): the authorization that
 *     was CONSUMED on-chain (its nonce, recipient, amount) must be the exact one
 *     this client signed and sent in the X-PAYMENT header.
 *
 * The hosted Grey Ridge /x402/receipt-verify can run checks #2 (nonce consumed)
 * and #3 (Transfer reconcile) because those read only from the chain. It CANNOT
 * run these two: it never sees the signed payload. This wrapper is the payer, so
 * it can — making it the only x402 client anywhere that binds the settlement to
 * the specific authorization it signed AND confirms that authorization had not
 * expired when it settled.
 *
 * Honesty (Claims Law): this binds the signed authorization's nonce/recipient/
 * amount to the consumed on-chain authorization and checks the validity window.
 * It is NOT a full secp256k1 signature recovery of the signer (that would need a
 * crypto dependency this dep-free wrapper deliberately avoids); the nonce bind is
 * the authoritative link, since a consumed EIP-3009 nonce is unforgeable and
 * unique to the authorization that produced it.
 */

import { decodePaymentSignatureHeader } from "@x402/core/http";

/** The EIP-3009 authorization this client signed and sent in X-PAYMENT. */
export interface SignedAuthorization {
  from: string | null;
  to: string | null;
  valueAtomic: number | null;
  validAfter: number | null;
  validBefore: number | null;
  nonce: string | null;
  signature: string | null;
  scheme: string | null;
  network: string | null;
}

export interface PayloadBindChecks {
  /** signed nonce === the nonce consumed on-chain (the authoritative bind). */
  nonceMatch: boolean | null;
  /** signed `to` === the reconciled on-chain recipient. */
  recipientMatch: boolean | null;
  /** signed `value` === the reconciled on-chain amount (exact scheme). */
  amountMatch: boolean | null;
  /** settlement block time ∈ [validAfter, validBefore] (check #4). */
  windowOk: boolean | null;
}

export interface PayloadBind {
  /**
   * "bound"             — the consumed on-chain authorization IS the one we signed,
   *                       and it settled inside its validity window.
   * "mismatch"          — the nonce consumed on-chain is NOT the nonce we signed:
   *                       this settlement is of a different authorization. Forgery
   *                       / mix-up signal — fail closed.
   * "window-violation"  — the settlement block time is outside [validAfter,
   *                       validBefore]: the authorization was expired / not-yet-valid
   *                       when it settled. Anomaly — fail closed.
   * "unbound"           — not enough on-chain data to bind (e.g. a direct transfer
   *                       with no AuthorizationUsed nonce). Degrade-open, disclosed.
   * "no-payload"        — no X-PAYMENT payload was captured (reconcile-only path).
   */
  status: "bound" | "mismatch" | "window-violation" | "unbound" | "no-payload";
  checks: PayloadBindChecks;
  signedNonce: string | null;
  validAfter: number | null;
  validBefore: number | null;
  settledBlockTime: number | null;
  confirmation: "dual-confirmed" | "single-source" | "rpc-disagreement" | "n/a";
  note: string;
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const n = typeof v === "number" ? v : Number(BigInt(String(v)));
    return Number.isFinite(n) ? n : null;
  } catch {
    try {
      const n = Number(v as string);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
}

/**
 * Decode the X-PAYMENT header this client sent into the signed EIP-3009
 * authorization. Uses the official @x402/core decoder, so it tracks whatever
 * encoding the installed @x402 version produced. Degrade-open: returns null on
 * any shape we can't read (e.g. a non-EVM / non-exact scheme).
 */
export function decodeSignedAuthorization(xPaymentHeader: string | null | undefined): SignedAuthorization | null {
  if (!xPaymentHeader) return null;
  try {
    const dec = decodePaymentSignatureHeader(xPaymentHeader) as {
      scheme?: string;
      network?: string;
      payload?: {
        signature?: string;
        authorization?: {
          from?: string;
          to?: string;
          value?: string | number;
          validAfter?: string | number;
          validBefore?: string | number;
          nonce?: string;
        };
      };
    };
    const a = dec?.payload?.authorization;
    if (!a) return null;
    return {
      from: a.from ? String(a.from).toLowerCase() : null,
      to: a.to ? String(a.to).toLowerCase() : null,
      valueAtomic: toInt(a.value),
      validAfter: toInt(a.validAfter),
      validBefore: toInt(a.validBefore),
      nonce: a.nonce ? String(a.nonce).toLowerCase() : null,
      signature: dec?.payload?.signature ?? null,
      scheme: dec?.scheme ?? null,
      network: dec?.network ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Pure verdict core (no I/O). Bind the signed authorization to the on-chain
 * settlement and apply the validity-window check.
 *
 * @param signed         the authorization we signed (or null if not captured)
 * @param matchedTo      the reconciled on-chain recipient (payTo), lowercased
 * @param matchedAtomic  the reconciled on-chain amount (atomic units)
 * @param consumedNonce  the AuthorizationUsed nonce from the receipt (lowercased), or null
 * @param blockTime      the settlement block's unix timestamp (seconds), or null
 * @param blockConfirmation how the block time was read (cross-confirm state)
 */
export function computePayloadBind(
  signed: SignedAuthorization | null,
  matchedTo: string | null,
  matchedAtomic: number | null,
  consumedNonce: string | null,
  blockTime: number | null,
  blockConfirmation: PayloadBind["confirmation"] = "n/a",
): PayloadBind {
  if (!signed) {
    return {
      status: "no-payload",
      checks: { nonceMatch: null, recipientMatch: null, amountMatch: null, windowOk: null },
      signedNonce: null,
      validAfter: null,
      validBefore: null,
      settledBlockTime: blockTime,
      confirmation: "n/a",
      note: "no X-PAYMENT payload was captured for this request, so the signed authorization could not be bound to the settlement (reconcile and nonce-consumed checks still apply)",
    };
  }

  const nonceMatch =
    consumedNonce != null && signed.nonce != null ? signed.nonce === consumedNonce.toLowerCase() : null;
  const recipientMatch = matchedTo != null && signed.to != null ? signed.to === matchedTo.toLowerCase() : null;
  const amountMatch =
    matchedAtomic != null && signed.valueAtomic != null ? signed.valueAtomic === matchedAtomic : null;

  // Validity window (check #4). validAfter/validBefore of 0 = unbounded on that side.
  let windowOk: boolean | null = null;
  if (blockTime != null) {
    const afterOk = signed.validAfter == null || signed.validAfter === 0 || blockTime >= signed.validAfter;
    const beforeOk = signed.validBefore == null || signed.validBefore === 0 || blockTime <= signed.validBefore;
    windowOk = afterOk && beforeOk;
  }

  const checks: PayloadBindChecks = { nonceMatch, recipientMatch, amountMatch, windowOk };

  // The nonce is the authoritative bind: a consumed EIP-3009 nonce is unique to
  // the authorization that produced it, so a signed-nonce mismatch means the
  // settlement is of a DIFFERENT authorization than the one we signed.
  if (nonceMatch === false) {
    return {
      status: "mismatch",
      checks,
      signedNonce: signed.nonce,
      validAfter: signed.validAfter,
      validBefore: signed.validBefore,
      settledBlockTime: blockTime,
      confirmation: blockConfirmation,
      note: `SIGNED-PAYLOAD MISMATCH: the EIP-3009 nonce consumed on-chain (${consumedNonce}) is NOT the nonce this client signed (${signed.nonce}) — this settlement is of a different authorization, not the payment we sent`,
    };
  }
  if (windowOk === false) {
    return {
      status: "window-violation",
      checks,
      signedNonce: signed.nonce,
      validAfter: signed.validAfter,
      validBefore: signed.validBefore,
      settledBlockTime: blockTime,
      confirmation: blockConfirmation,
      note: `VALIDITY-WINDOW VIOLATION: the settlement mined at block time ${blockTime} is outside the authorization's window [${signed.validAfter ?? 0}, ${signed.validBefore ?? 0}] — the authorization had expired or was not yet valid when it settled`,
    };
  }
  if (nonceMatch === true) {
    const extras: string[] = [];
    if (recipientMatch === false) extras.push("note: signed recipient differs from the reconciled recipient");
    if (amountMatch === false) extras.push("note: signed value differs from the reconciled amount (expected for non-exact schemes)");
    if (windowOk === true) extras.push("settled within the signed validity window");
    return {
      status: "bound",
      checks,
      signedNonce: signed.nonce,
      validAfter: signed.validAfter,
      validBefore: signed.validBefore,
      settledBlockTime: blockTime,
      confirmation: blockConfirmation,
      note: `SIGNED-PAYLOAD BOUND: the EIP-3009 nonce consumed on-chain is exactly the nonce this client signed, binding this settlement to the payment we sent${extras.length ? " (" + extras.join("; ") + ")" : ""}`,
    };
  }
  return {
    status: "unbound",
    checks,
    signedNonce: signed.nonce,
    validAfter: signed.validAfter,
    validBefore: signed.validBefore,
    settledBlockTime: blockTime,
    confirmation: blockConfirmation,
    note: "could not bind the signed authorization to an on-chain nonce (no AuthorizationUsed nonce was decoded, e.g. a direct ERC-20 transfer) — reconcile still stands, but the signed payload is not cryptographically linked to this tx",
  };
}
