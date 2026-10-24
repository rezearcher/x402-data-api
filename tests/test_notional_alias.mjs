/**
 * Contract tests for notionalQ — the trade-size param reader behind the paid
 * /gate/swap route and the free /gate/swap/preview (src/index.ts).
 *
 *   node tests/test_notional_alias.mjs
 *
 * notional drives the pool-depth / price-impact decision. A caller that passes
 * the trade size under the camelCase name `notionalUsd` (the name our own
 * ElizaOS / LangChain / Vercel plugins use for the arg internally, and the
 * natural first guess for a raw API caller) MUST NOT be silently defaulted to
 * $100 — that returns a dangerously-wrong GO for a large trade whose real
 * impact would be BLOCK/HOLD. These assertions pin that all three names
 * (notional_usd, notional, notionalUsd) are honored, that a present-but-invalid
 * value is rejected (null → handler 400), and that an absent value defaults to
 * 100. Real export from the Worker module via the same cfw-hooks type-stripping
 * loader the verify / sized_verdict suites use — tests the shipped code.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { notionalQ } = await import("../src/index.ts");

// Minimal hono-context stub: only .req.query(k) is exercised.
const ctx = (q) => ({ req: { query: (k) => q[k] } });

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

check("snake_case notional_usd honored", () => {
  assert.strictEqual(notionalQ(ctx({ notional_usd: "5000" })), 5000);
});

check("camelCase notionalUsd honored (regression: was silently $100)", () => {
  assert.strictEqual(notionalQ(ctx({ notionalUsd: "500000" })), 500000);
});

check("bare notional honored", () => {
  assert.strictEqual(notionalQ(ctx({ notional: "250" })), 250);
});

check("absent -> default 100", () => {
  assert.strictEqual(notionalQ(ctx({})), 100);
});

check("empty string treated as absent -> default 100", () => {
  assert.strictEqual(notionalQ(ctx({ notional_usd: "" })), 100);
});

check("snake_case wins over camelCase when both present", () => {
  assert.strictEqual(notionalQ(ctx({ notional_usd: "1000", notionalUsd: "9" })), 1000);
});

check("present-but-non-numeric -> null (handler 400s)", () => {
  assert.strictEqual(notionalQ(ctx({ notionalUsd: "abc" })), null);
});

check("present-but-zero -> null (handler 400s)", () => {
  assert.strictEqual(notionalQ(ctx({ notional_usd: "0" })), null);
});

check("present-but-negative -> null (handler 400s)", () => {
  assert.strictEqual(notionalQ(ctx({ notional: "-50" })), null);
});

console.log(`\n# notionalQ alias contract: ${pass}/${pass} passed`);
