/**
 * Contract test for same-origin cross-sell (upsellOriginFor).
 *
 *   node --test tests/test_upsell_same_origin.mjs
 *
 * The see_also upsell is a FUNCTIONAL url an agent CALLS to pay — so it must land
 * on the SAME host the buyer already completed its x402 handshake on, not the
 * canonical brand host. Our proven payers all transact on the workers.dev host;
 * a cross-host upsell forces a fresh DNS resolve + fresh 402 handshake + the
 * documented bot-fight 403 risk for datacenter-IP agents at the 10x upgrade step.
 * This locks: (a) a known serving host is mirrored into the upsell URLs, (b) a
 * spoofed/foreign Host degrades to the canonical brand origin, (c) injectSeeAlso
 * end-to-end emits upsell resources on the serving origin.
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { upsellOriginFor, injectSeeAlso } = await import("../src/index.ts");

const WORKERS = "https://x402-data-api.sigrunner.workers.dev";
const BRAND = "https://api.greyridgesignals.ai";

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// (a) each of our own serving hosts is mirrored into the upsell origin.
eq(upsellOriginFor(WORKERS + "/defi/yields"), WORKERS, "workers.dev serving host is mirrored (not canonicalized)");
eq(upsellOriginFor(BRAND + "/defi/yields"), BRAND, "brand serving host is preserved");

// (b) a spoofed/foreign Host degrades to the canonical brand origin, never reflects.
eq(upsellOriginFor("https://evil.example.com/defi/yields"), BRAND, "foreign host falls back to canonical (no Host reflection)");
eq(upsellOriginFor("not a url"), BRAND, "garbage url degrades to canonical");

// (c) end-to-end: a 200 body paid on workers.dev gets a workers.dev upsell URL.
const body = JSON.stringify({ preview: [{ pool: "abc" }], total_available: 20 });
const injected = injectSeeAlso(body, "/defi/yields/preview", upsellOriginFor(WORKERS + "/defi/yields/preview"));
const parsed = JSON.parse(injected);
ok(parsed._greyridge && Array.isArray(parsed._greyridge.see_also) && parsed._greyridge.see_also.length >= 1,
  "see_also is injected");
for (const e of parsed._greyridge.see_also) {
  ok(e.resource.startsWith(WORKERS + "/"), `upsell resource stays on the serving (workers.dev) host: ${e.resource}`);
  if (e.preview) ok(e.preview.startsWith(WORKERS + "/"), `upsell preview stays on the serving host: ${e.preview}`);
}

console.log(`# upsell same-origin: ${pass} assertions passed`);
