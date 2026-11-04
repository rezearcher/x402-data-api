/**
 * Contract test for the M5 paid-response cache hardening (applyPaidNoStore).
 *
 *   node tests/test_paid_no_store.mjs
 *
 * arXiv 2605.11781 "Five Attacks on x402", Attack III — HTTP/proxy cache
 * leakage: a paid 200 body that a shared/proxy/browser cache stores can be
 * replayed to a later UNPAID client. Mitigation M5: mark paid responses
 * non-cacheable. The x402 settlement header `PAYMENT-RESPONSE` is the
 * ground-truth signal a body was paid for (no hardcoded route list), so the
 * hardening keys off its presence: on a paid response force
 * `Cache-Control: no-store` (overriding the library's weaker `private`) and add
 * `X-PAYMENT` to `Vary`; on any free/unpaid response leave headers untouched.
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { applyPaidNoStore } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// 1. A paid response (PAYMENT-RESPONSE present) gets no-store + Vary: X-PAYMENT.
{
  const h = new Headers({ "PAYMENT-RESPONSE": "eyJzdWNjZXNzIjp0cnVlfQ==", "Content-Type": "application/json" });
  applyPaidNoStore(h);
  eq(h.get("Cache-Control"), "no-store", "paid 200 → Cache-Control no-store");
  ok(/\bX-PAYMENT\b/i.test(h.get("Vary") || ""), "paid 200 → Vary includes X-PAYMENT");
}

// 2. A free/unpaid response (no PAYMENT-RESPONSE) is left completely untouched —
//    /preview, /metrics, catalog must stay cacheable.
{
  const h = new Headers({ "Cache-Control": "public, max-age=300", "Content-Type": "application/json" });
  applyPaidNoStore(h);
  eq(h.get("Cache-Control"), "public, max-age=300", "free response Cache-Control untouched");
  eq(h.get("Vary"), null, "free response Vary not added");
}

// 3. Overrides the x402 library's weaker `private` (set on its failure/skip paths)
//    with the strictly-stronger no-store on a paid response.
{
  const h = new Headers({ "PAYMENT-RESPONSE": "x", "Cache-Control": "private" });
  applyPaidNoStore(h);
  eq(h.get("Cache-Control"), "no-store", "paid response: private overridden to no-store");
}

// 4. Preserves an existing Vary and appends X-PAYMENT once (idempotent, no dup).
{
  const h = new Headers({ "PAYMENT-RESPONSE": "x", "Vary": "Accept-Encoding" });
  applyPaidNoStore(h);
  ok(/accept-encoding/i.test(h.get("Vary")), "existing Vary preserved");
  ok(/\bx-payment\b/i.test(h.get("Vary")), "X-PAYMENT appended to existing Vary");
  // run twice — must not duplicate
  applyPaidNoStore(h);
  const count = (h.get("Vary").toLowerCase().match(/x-payment/g) || []).length;
  eq(count, 1, "X-PAYMENT appears exactly once after repeated application");
}

// 5. Vary already containing X-PAYMENT is not duplicated.
{
  const h = new Headers({ "PAYMENT-RESPONSE": "x", "Vary": "X-PAYMENT" });
  applyPaidNoStore(h);
  eq(h.get("Vary"), "X-PAYMENT", "Vary already X-PAYMENT stays single");
}

console.log(`✓ paid-no-store (M5) contract: ${pass} assertions passed`);
