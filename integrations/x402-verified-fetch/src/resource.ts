/**
 * Cross-resource substitution binding — the 4th x402 flaw CLASS (arXiv:2605.30998).
 *
 * The x402 `exact` scheme (and every scheme deployed today) signs
 * (from, to, value, validAfter, validBefore, nonce) but NEVER the resource. So a
 * settlement to the right `payTo` for the right amount proves nothing about WHICH
 * resource it paid for: the same on-chain payment reconcile-validates as
 * proof-of-payment for ANY x402 resource that shares that (payTo, amount). This
 * is the cross-resource substitution risk the reconcile/#2/#1/#4 checks cannot
 * see, because they are all about the money, not the resource.
 *
 * Why the WRAPPER can bind this harder than any hosted verifier:
 * a hosted `/receipt-verify` only ever gets a `url` the caller CLAIMS they paid —
 * it cannot know which resource the client actually requested. This wrapper IS
 * the payer: it holds the exact URL the agent fetched (`requestedUrl`) and reads
 * the live 402 that URL answers with, so the "which resource did I pay for"
 * comparison is against ground truth the client observed first-hand, not a
 * self-reported parameter.
 */

export interface ResourceBinding {
  verdict: "DECLARED" | "SUBSTITUTABLE" | "RESOURCE_MISMATCH" | "UNVERIFIED";
  scheme: string | null;
  /**
   * x402's exact scheme does NOT sign the resource into the transfer
   * authorization, so a resource binding — when present — is a challenge-level
   * DECLARATION by the seller, never a cryptographic commitment. Always false
   * for every scheme deployed today; disclosed so a verdict is never oversold.
   */
  schemeBindsResource: boolean;
  /** the `resource` the live 402 advertised (null if it declared none). */
  challengeResource: string | null;
  /** the url the client actually fetched and paid for (ground truth, not claimed). */
  requestedUrl: string | null;
  /** declared resource ~ requested url (host + path). null => a side could not be parsed. */
  matches: boolean | null;
  /** from the EIP-3009 proof (#2) — post-spend the on-chain settlement is singular. */
  nonceConsumed: boolean | null;
  note: string;
}

/**
 * Extract the resource URL string from an x402 challenge's `resource` value,
 * which may be a plain URL string OR a metadata object { url, description, ... }
 * (the shape Coinbase's x402 middleware emits at the top level). Returns a
 * trimmed non-empty string, else null.
 */
export function extractResourceUrl(resRaw: unknown): string | null {
  if (typeof resRaw === "string") return resRaw.trim() || null;
  if (resRaw && typeof resRaw === "object") {
    const u = (resRaw as Record<string, unknown>).url;
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  return null;
}

/**
 * Normalize + compare a challenge's declared resource against the paid url.
 * challengeResource may be absolute or a path relative to the endpoint; we
 * compare host (case-insensitive) + pathname (trailing-slash-insensitive),
 * ignoring query/fragment. null => a side could not be parsed.
 */
export function resourceMatchesUrl(
  challengeResource: string | null,
  requestedUrl: string | null,
): boolean | null {
  if (!challengeResource || !requestedUrl) return null;
  try {
    const want = new URL(requestedUrl);
    const got = new URL(challengeResource, requestedUrl); // resolves a relative resource against the endpoint
    const normPath = (p: string) => p.replace(/\/+$/, "") || "/";
    return want.host.toLowerCase() === got.host.toLowerCase() && normPath(want.pathname) === normPath(got.pathname);
  } catch {
    return null;
  }
}

/**
 * Pure core (no I/O). Decide the cross-resource-substitution verdict from the
 * live 402 challenge's declared resource and the url the client actually paid.
 *
 *   UNVERIFIED        — no url to check, or no live 402 challenge was obtained
 *   SUBSTITUTABLE     — a 402 was read but it declares NO resource → nothing
 *                       beyond (payTo, amount) ties this settlement to a resource
 *   RESOURCE_MISMATCH — the declared resource is a DIFFERENT resource than the url
 *                       (fail-closed: do not treat this as proof of the paid url)
 *   DECLARED          — the declared resource matches the url (seller asserts the
 *                       payment is for this resource; a declaration, not a signature)
 */
export function computeResourceBinding(
  requestedUrl: string | null,
  challengeFetched: boolean,
  challengeResource: string | null,
  scheme: string | null,
  nonceConsumed: boolean | null,
): ResourceBinding {
  const common = {
    scheme: scheme ?? null,
    schemeBindsResource: false,
    challengeResource: challengeResource ?? null,
    requestedUrl: requestedUrl ?? null,
    nonceConsumed,
  };
  if (!requestedUrl) {
    return {
      ...common,
      verdict: "UNVERIFIED",
      matches: null,
      note: "no requested url was captured — this settlement was reconciled by payTo + amount only, so its cross-resource binding cannot be assessed (cross-resource substitution, arXiv:2605.30998).",
    };
  }
  if (!challengeFetched) {
    return {
      ...common,
      verdict: "UNVERIFIED",
      matches: null,
      note: `could not read a live 402 challenge from ${requestedUrl} (unreachable, or it did not answer with an x402 challenge) — the payTo + amount reconciliation stands, but the resource binding is unverified.`,
    };
  }
  if (challengeResource === null) {
    return {
      ...common,
      verdict: "SUBSTITUTABLE",
      matches: null,
      note: `the live 402 at ${requestedUrl} declares NO \`resource\` field, so nothing beyond (payTo, amount) ties this settlement to a specific resource: the same on-chain payment would reconcile-validate as proof-of-payment for ANY x402 resource sharing this payTo + amount (cross-resource substitution, arXiv:2605.30998). x402's exact scheme does not sign the resource into the transfer authorization, so no verifier — including the facilitator — can cryptographically say which resource this settlement paid for.`,
    };
  }
  const matches = resourceMatchesUrl(challengeResource, requestedUrl);
  if (matches === false) {
    return {
      ...common,
      verdict: "RESOURCE_MISMATCH",
      matches,
      note: `the live 402 declares resource=${challengeResource}, which does NOT match the url you fetched and paid (${requestedUrl}) — the challenge issued there is for a different resource. Do not treat this settlement as proof of payment for ${requestedUrl}.`,
    };
  }
  const consumedNote =
    nonceConsumed === true
      ? " Its EIP-3009 nonce is consumed on-chain, so the on-chain spend itself is singular (not re-spendable); the residual exposure is pre-settlement in-flight substitution of the signed payload."
      : nonceConsumed === false
        ? " Note: the nonce is NOT confirmed consumed, so a still-valid authorization for this (payTo, amount) remains structurally transplantable to another resource until spent."
        : "";
  return {
    ...common,
    verdict: "DECLARED",
    matches: matches === null ? null : true,
    note: `the live 402 declares resource=${challengeResource}, matching the url you paid — the seller asserts this payment is for this resource. Caveat: x402's exact scheme signs (from, to, value, validAfter, validBefore, nonce) but NOT the resource, so this is a challenge-level declaration, not a cryptographic binding (cross-resource substitution, arXiv:2605.30998).${consumedNote}`,
  };
}
