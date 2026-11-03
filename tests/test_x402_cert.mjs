/**
 * Seller-side DEEP VERIFIED certificate (/x402/cert) — regression guard.
 *
 *   node tests/test_x402_cert.mjs
 *
 * Locks:
 *  1. certGrade: 6/6 tiers -> "deep-verified"; partial -> "audited-N/6".
 *  2. certBadgeShields: no cert -> grey "uncertified"; expired -> grey;
 *     valid + live PAY -> brightgreen with the expiry date; valid cert but a
 *     degraded live re-audit -> red/orange "degraded" (the honest downgrade).
 *  3. Live contract (deterministic, no network):
 *     - /x402/cert is the PAID mint route -> x402-gated (402 before the audit).
 *     - /x402/cert/badge with no url -> valid shields schema, never 500.
 *     - /x402/cert/badge for an un-certified host (KV absent in test) -> grey.
 *     - /x402/cert/verify with no match -> 404 valid:false.
 *     - /x402/cert/preview -> the certificate shape + $1 mint recipe, free.
 *     - none of the free routes are x402-gated (never 402).
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const mod = await import("../src/index.ts");
const { default: app, certGrade, certBadgeShields, certCanonical } = mod;

// ---- certGrade -------------------------------------------------------------
const full = { live: true, reliable: true, price_accurate: true, delivery_specified: true, injection_safe: true, payto_clear: true };
let g = certGrade(full);
assert.equal(g.depth_passed, 6, "6/6 tiers");
assert.equal(g.grade, "deep-verified", "full -> deep-verified");

const partial = { ...full, price_accurate: false, delivery_specified: false };
g = certGrade(partial);
assert.equal(g.depth_passed, 4, "4/6 tiers");
assert.equal(g.grade, "audited-4/6", "partial -> audited-N/6");

// ---- certBadgeShields ------------------------------------------------------
const now = Date.parse("2026-11-03T00:00:00.000Z");
const futureExp = "2026-12-03T00:00:00.000Z";
const pastExp = "2026-10-01T00:00:00.000Z";

// no cert -> grey uncertified
let b = certBadgeShields(null, null, now);
assert.equal(b.color, "lightgrey");
assert.equal(b.message, "uncertified");

const validCert = { cert_id: "grsg-x", host: "seller.example", url: "https://seller.example/data", issued_at: "2026-11-03T00:00:00.000Z", expires_at: futureExp, verdict: "PAY", depth_passed: 6, depth_total: 6, grade: "deep-verified", tiers: full, sig: "deadbeef", issuer: "did:web:api.greyridgesignals.ai" };

// expired cert -> grey, regardless of live
b = certBadgeShields({ ...validCert, expires_at: pastExp }, { verdict: "PAY" }, now);
assert.equal(b.color, "lightgrey");
assert.equal(b.message, "cert expired", "expired -> grey 'cert expired'");

// valid cert + live PAY -> brightgreen with the expiry date and deep-verified mark
b = certBadgeShields(validCert, { verdict: "PAY" }, now);
assert.equal(b.color, "brightgreen", "valid + live PAY -> green");
assert.ok(/deep-verified/.test(b.message), `green shows deep-verified, got "${b.message}"`);
assert.ok(/2026-12-03/.test(b.message), "green shows expiry date");

// valid cert but AVOID live re-audit -> red "degraded" (honest downgrade)
b = certBadgeShields(validCert, { verdict: "AVOID" }, now);
assert.equal(b.color, "red", "certified but AVOID now -> red");
assert.ok(/degraded/.test(b.message), `degraded surfaced, got "${b.message}"`);

// valid cert but CAUTION live re-audit -> orange "degraded"
b = certBadgeShields(validCert, { verdict: "CAUTION" }, now);
assert.equal(b.color, "orange", "certified but CAUTION now -> orange");
assert.ok(/degraded/.test(b.message));

// partial-grade cert still green but no false "deep-verified"
b = certBadgeShields({ ...validCert, grade: "audited-4/6" }, { verdict: "PAY" }, now);
assert.equal(b.color, "brightgreen");
assert.ok(!/deep-verified/.test(b.message), "partial cert must not claim deep-verified");

// ---- on-chain SETTLEMENT PROOF (the depth axis a liveness badge cannot make) --
const provenSettlement = { proven: true, tx: "0x" + "a".repeat(64), block: 48783946, confirmation: "dual-confirmed", amount_usdc: "0.005000", payTo: "0x1234567890123456789012345678901234567890", rpc_sources: ["mainnet.base.org", "base-rpc.publicnode.com"] };
const settledCert = { ...validCert, settlement: provenSettlement };

// a settlement-proven cert leads the badge with "settlement-proven ✓" (not just a depth grade)
b = certBadgeShields(settledCert, { verdict: "PAY" }, now);
assert.equal(b.color, "brightgreen", "settlement-proven cert is green");
assert.ok(/settlement-proven ✓/.test(b.message), `settlement-proven leads the badge, got "${b.message}"`);
// the Base BLOCK NUMBER is rendered INLINE on the public badge so the on-chain
// proof is checkable at a glance — the receipt a liveness-only rival can't show
assert.ok(b.message.includes(String(provenSettlement.block)), `proven badge renders the Base block inline, got "${b.message}"`);
// a proven settlement whose block is unknown must NOT fabricate a block on the badge
const noBlk = certBadgeShields({ ...validCert, settlement: { ...provenSettlement, block: null } }, { verdict: "PAY" }, now);
assert.ok(/settlement-proven ✓/.test(noBlk.message) && !/blk/.test(noBlk.message), "no block -> still proven, but no fabricated block label");

// a cert whose settlement.proven is false does NOT claim settlement-proven
b = certBadgeShields({ ...validCert, settlement: { ...provenSettlement, proven: false } }, { verdict: "PAY" }, now);
assert.ok(!/settlement-proven/.test(b.message), "proven:false must not claim settlement-proven");

// an endpoint that breaks AFTER a settlement-proven cert still degrades honestly
b = certBadgeShields(settledCert, { verdict: "AVOID" }, now);
assert.equal(b.color, "red", "settlement-proven but now AVOID -> honest red downgrade");
assert.ok(/degraded/.test(b.message), "live re-audit still downgrades a settlement-proven cert");

// ---- certCanonical: settlement is signed, and depth-only certs are unchanged --
// a depth-only cert's canonical must be byte-identical whether settlement is
// undefined or explicitly absent (backward compat: pre-settlement certs verify).
const depthOnly = { cert_id: "grsg-x", host: "seller.example", url: "https://seller.example/data", issued_at: "2026-11-03T00:00:00.000Z", expires_at: futureExp, verdict: "PAY", depth_passed: 6, tiers: full };
assert.equal(certCanonical(depthOnly), certCanonical({ ...depthOnly, settlement: null }), "settlement:null canonical == omitted (backward compat)");
assert.ok(!certCanonical(depthOnly).includes("settlement"), "depth-only canonical omits the settlement key entirely");

// a settlement-bearing canonical DOES include the proof, so tampering with it
// changes the signed string (tamper-evidence extends to the on-chain proof).
const withSettle = certCanonical({ ...depthOnly, settlement: provenSettlement });
assert.ok(withSettle.includes("settlement") && withSettle.includes(provenSettlement.tx), "settlement canonical carries the tx");
assert.notEqual(withSettle, certCanonical({ ...depthOnly, settlement: { ...provenSettlement, tx: "0x" + "b".repeat(64) } }), "changing the settlement tx changes the canonical (tamper-evident)");

// ---- live contract (no network; KV absent in test env) --------------------
// cert mint is the PAID route -> x402-gated (payment required before the audit)
let res = await app.request("/x402/cert?url=https%3A%2F%2Fseller.example%2Fdata", {}, {});
assert.equal(res.status, 402, "cert mint is x402-gated -> 402 unpaid");

// badge with no url -> valid shields schema, never 500
res = await app.request("/x402/cert/badge", {}, {});
assert.equal(res.status, 200, "no-url badge is 200");
let j = await res.json();
assert.equal(j.schemaVersion, 1, "shields schemaVersion");
assert.equal(j.color, "lightgrey");

// badge for a real url but no cert on record -> grey uncertified (KV absent)
res = await app.request("/x402/cert/badge?url=https%3A%2F%2Fseller.example%2Fdata", {}, {});
assert.equal(res.status, 200);
j = await res.json();
assert.equal(j.color, "lightgrey", "no cert -> grey");
assert.equal(j.message, "uncertified");

// verify with nothing on record -> 404 valid:false
res = await app.request("/x402/cert/verify?id=grsg-nope", {}, {});
assert.equal(res.status, 404, "unknown cert -> 404");
j = await res.json();
assert.equal(j.valid, false);
assert.equal(j.status, "NOT_FOUND");

// preview -> free, certificate shape + $1 mint recipe
res = await app.request("/x402/cert/preview", {}, {});
assert.equal(res.status, 200, "preview is free 200");
j = await res.json();
assert.equal(j.sample, true);
assert.ok(j.example_certificate && j.example_certificate.grade === "deep-verified", "preview shows a sample cert");
assert.ok(/\$1\.00/.test(j.mint), "preview quotes the $1.00 mint price");
assert.ok(/img\.shields\.io\/endpoint/.test(j.badge_when_issued), "preview shows the badge embed recipe");

// none of the free routes are x402-gated
for (const p of ["/x402/cert/badge?url=https%3A%2F%2Fx%2Fy", "/x402/cert/verify?id=z", "/x402/cert/preview"]) {
  res = await app.request(p, {}, {});
  assert.notEqual(res.status, 402, `${p} must be free, never 402`);
}

console.log("ok - test_x402_cert: grade + badge shields (incl. honest live downgrade) + free render/verify/preview contract locked");
