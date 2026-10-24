/**
 * Deterministic contract tests for the GoPlus-parity DEX buy/sell-tax verdict
 * mapping (src/index.ts: dexTaxRisk).
 *
 *   node tests/test_dex_tax_risk.mjs
 *
 * The live sim that PRODUCES buyTaxBps/sellTaxBps is validated against clean
 * tokens by the uptime_probe canary (usdc/weth/degen/aero/cbbtc read ~0). This
 * suite pins the money-gate DECISION those measurements feed: a measured high
 * sell tax must force AVOID and survive the deep-liquidity offset, a moderate
 * fee must only annotate (not flag), and null tax must contribute nothing
 * (degrade-open). It tests the shipped export, not a copy. Node >= 22.18 strips
 * types; the virtual cloudflare:workers module is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { dexTaxRisk } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

// 1. Clean token (0/0) → no reasons, no score change, not high. The churn-safety
//    invariant: a legitimate token must never be touched by this signal.
check("clean 0/0 tax contributes nothing", () => {
  const r = dexTaxRisk(0, 0);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.scoreFloor, null);
  assert.equal(r.scoreAdd, 0);
  assert.equal(r.highDexTax, false);
});

// 2. null tax (no pool / non-standard storage / pair revert) → degrade-open, inert.
check("null/null tax is inert (degrade-open)", () => {
  const r = dexTaxRisk(null, null);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.scoreFloor, null);
  assert.equal(r.scoreAdd, 0);
  assert.equal(r.highDexTax, false);
});

// 3. High sell tax (>=15%) → AVOID floor (70) + survives deep-liq offset + a reason.
check("15%+ sell tax forces AVOID floor and highDexTax", () => {
  const r = dexTaxRisk(0, 2500); // 25% sell
  assert.equal(r.scoreFloor, 70);
  assert.equal(r.highDexTax, true);
  assert.ok(/sell tax ~25\.0%/.test(r.reasons[0]), `reason wrong: ${r.reasons[0]}`);
});

// 4. Exactly at the 15% boundary (1500 bps) → still trips (>=, not >).
check("sell tax exactly 1500 bps trips the AVOID floor", () => {
  const r = dexTaxRisk(0, 1500);
  assert.equal(r.scoreFloor, 70);
  assert.equal(r.highDexTax, true);
});

// 5. High buy tax (>=15%) with low sell → review floor (55), still highDexTax.
check("15%+ buy tax raises to review floor", () => {
  const r = dexTaxRisk(2000, 0); // 20% buy, 0 sell
  assert.equal(r.scoreFloor, 55);
  assert.equal(r.highDexTax, true);
  assert.ok(/buy tax ~20\.0%/.test(r.reasons[0]), `reason wrong: ${r.reasons[0]}`);
});

// 6. Moderate fee (3-15%) → small additive flag only, never AVOID, never highDexTax.
check("moderate 5% fee annotates without flagging", () => {
  const r = dexTaxRisk(500, 500); // 5%/5%
  assert.equal(r.scoreFloor, null);
  assert.equal(r.scoreAdd, 8);
  assert.equal(r.highDexTax, false);
  assert.ok(/buy ~5\.0%/.test(r.reasons[0]) && /sell ~5\.0%/.test(r.reasons[0]), `reason wrong: ${r.reasons[0]}`);
});

// 7. Just under the 3% annotation floor (299 bps) → fully inert (no noise on dust).
check("sub-3% fee is inert", () => {
  const r = dexTaxRisk(299, 299);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.scoreAdd, 0);
});

// 8. Sell-tax severity wins over a simultaneous high buy tax (AVOID beats review).
check("high sell tax dominates a simultaneous high buy tax", () => {
  const r = dexTaxRisk(2000, 2000);
  assert.equal(r.scoreFloor, 70); // sell branch, not buy's 55
  assert.equal(r.highDexTax, true);
});

console.log(`\n# dex_tax_risk: ${pass} passed, 0 failed`);
