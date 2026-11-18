/**
 * Contract tests for buildPaidDeliveryRecord (src/index.ts).
 *
 *   node tests/test_paid_delivery_record.mjs
 *
 * The paid-call middleware builds a seller-side PAID delivery record from the
 * x402 payment header + facilitator PAYMENT-RESPONSE header. Historically it
 * logged only payer + settled txHash, discarding the signed EIP-3009 nonce and
 * authorized value — the join/disambiguation fields a downstream offline
 * collector needs to bind a delivery to its on-chain settlement by nonce
 * (vet402's method) without inferring the amount from the catalog price, which
 * scripts/preflight_attribution.py forbids. These tests pin that the record now
 * carries nonce + auth_value + a never-empty delivery_id, and that it is
 * fail-open (undecodable headers degrade to safe defaults, never throw).
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { buildPaidDeliveryRecord } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`ok - ${name}`); }

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");
const NONCE = "0x" + "b".repeat(64);
const PAYER = "0x" + "A".repeat(40);
const TX = "0x" + "1".repeat(64);

const payHeader = b64({
  x402Version: 1, scheme: "exact", network: "base",
  payload: { signature: "0xsig", authorization: {
    from: PAYER, to: "0x" + "2".repeat(40), value: "1000",
    validAfter: "0", validBefore: "99999999999", nonce: NONCE,
  } },
});
const prHeader = b64({ success: true, transaction: TX, network: "base", payer: PAYER });

// 1. Full decode: nonce + authorized value + delivery_id(=nonce) + ts.
check("captures nonce, auth_value, payer, tx, delivery_id from valid headers", () => {
  const r = buildPaidDeliveryRecord({ payHeader, paymentResponseHeader: prHeader, path: "/x402/preflight", ref: "partnerX", nowMs: 1700000000000 });
  assert.equal(r.evt, "PAID");
  assert.equal(r.path, "/x402/preflight");
  assert.equal(r.payer, PAYER.toLowerCase());
  assert.equal(r.tx, TX);
  assert.equal(r.nonce, NONCE, "nonce must be captured (previously discarded)");
  assert.equal(r.auth_value, "1000", "authorized value must be captured, not catalog-inferred");
  assert.equal(r.delivery_id, NONCE, "delivery_id uses the stable signed nonce when present");
  assert.equal(r.ts, 1700000000, "ts is integer UTC seconds (floor of nowMs/1000)");
  assert.equal(r.ref, "partnerx");
});

// 2. payment-response payer wins over the request-header decode.
check("PAYMENT-RESPONSE payer overrides request-header payer", () => {
  const otherPay = b64({ payload: { authorization: { from: "0x" + "c".repeat(40), value: "5", nonce: NONCE } } });
  const r = buildPaidDeliveryRecord({ payHeader: otherPay, paymentResponseHeader: prHeader, path: "/p" });
  assert.equal(r.payer, PAYER.toLowerCase(), "settled payer is authoritative");
});

// 3. Fail-open: undecodable payment header -> defaults, delivery_id still non-empty.
check("undecodable payment header degrades open, delivery_id never empty", () => {
  const r = buildPaidDeliveryRecord({ payHeader: "!!!not-base64!!!", path: "/p", nowMs: 1700000000000 });
  assert.equal(r.payer, "unknown");
  assert.equal(r.nonce, "");
  assert.equal(r.auth_value, "");
  assert.equal(r.tx, "");
  assert.ok(r.delivery_id.length > 0, "delivery_id falls back to a non-empty id (adapter requires it)");
  assert.notEqual(r.delivery_id, "", "never empty");
});

// 4. Missing payment-response header: payer/nonce/value still come from pay header; tx empty.
check("absent PAYMENT-RESPONSE leaves tx empty but keeps signed fields", () => {
  const r = buildPaidDeliveryRecord({ payHeader, paymentResponseHeader: null, path: "/p" });
  assert.equal(r.tx, "");
  assert.equal(r.nonce, NONCE);
  assert.equal(r.payer, PAYER.toLowerCase());
  assert.equal(r.auth_value, "1000");
});

// 5. ref sanitisation: strips unsafe chars, caps length, lowercases.
check("ref is sanitised to an opaque short slug", () => {
  const r = buildPaidDeliveryRecord({ payHeader, path: "/p", ref: "Bad Ref/<script>" + "z".repeat(60) });
  assert.ok(/^[a-z0-9_-]*$/.test(r.ref), "only safe chars");
  assert.ok(r.ref.length <= 40, "capped at 40");
});

// 6. Reproducibility: same nonce -> same delivery_id (stable join identity).
check("delivery_id is stable/reproducible across calls with the same nonce", () => {
  const a = buildPaidDeliveryRecord({ payHeader, path: "/p" });
  const b = buildPaidDeliveryRecord({ payHeader, path: "/p" });
  assert.equal(a.delivery_id, b.delivery_id, "nonce-derived delivery_id is deterministic");
});

// 7. Explicit deliveryId override wins.
check("explicit deliveryId overrides the nonce-derived default", () => {
  const r = buildPaidDeliveryRecord({ payHeader, path: "/p", deliveryId: "custom-123" });
  assert.equal(r.delivery_id, "custom-123");
});

console.log(`\n${pass} passed`);
