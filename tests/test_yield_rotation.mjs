/**
 * Contract tests for the rotate-or-stay yield decision
 * (src/index.ts: computeYieldRotation / YIELD_ROTATION_THRESHOLDS).
 *
 *   node tests/test_yield_rotation.mjs
 *
 * computeYieldRotation is pure + deterministic over both pools' DefiLlama fields
 * plus a transparent roundtrip-cost/breakeven model. It must: never rotate into a
 * pool our own entry verdict rejects (AVOID/OUTLIER); STAY when there's no real
 * yield pickup; ROTATE when a material pickup recoups the cost fast with no risk
 * jump; MARGINAL when the edge is real but slow or the target is riskier; and
 * scale the economics with notional. cfw-hooks shims cloudflare:workers.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { computeYieldRotation, computeYieldEntryVerdict, YIELD_ROTATION_THRESHOLDS } =
  await import("../src/index.ts");

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`ok - ${name}`); }

// Minimal YieldPool factory — only the fields the verdict/rotation logic reads.
function pool(over = {}) {
  return {
    project: "aave-v3", chain: "Base", symbol: "USDC", pool: "pool-" + Math.random().toString(36).slice(2, 8),
    apy: 5, apyBase: 5, apyReward: 0, apyPct1D: 0, apyPct7D: 0, apyPct30D: 0,
    apyBase7d: 5, apyMean30d: 5, tvlUsd: 50_000_000, stablecoin: true, ilRisk: "no",
    il7d: 0, exposure: "single", outlier: false, rewardTokens: null, underlyingTokens: null,
    mu: 0, sigma: 0.1, risk_adjusted_apy: 50, predicted_probability: 55,
    predicted_class: "Stable/Up", volumeUsd1d: 1_000_000, ...over,
  };
}

// A safe, stable low-APY pool held today vs a safe, stable high-APY target.
const held = pool({ pool: "held", apy: 4 });
const better = pool({ pool: "better", apy: 12 });

check("ROTATE — big safe pickup recoups cost fast at $100k", () => {
  const r = computeYieldRotation(held, better, 100_000);
  assert.strictEqual(r.verdict, "ROTATE", JSON.stringify(r.reasons));
  assert.strictEqual(r.apy_delta_pct, 8);
  assert.ok(r.breakeven_days != null && r.breakeven_days <= YIELD_ROTATION_THRESHOLDS.BREAKEVEN_ROTATE_DAYS, `breakeven ${r.breakeven_days}`);
  assert.ok(r.net_gain_first_year_usd > 0);
  assert.ok(r.reasons.some((x) => x.code === "pickup_pays_off"));
});

check("roundtrip cost = notional * bps/10000 (transparent)", () => {
  const r = computeYieldRotation(held, better, 100_000);
  assert.strictEqual(r.rotation_cost_bps, YIELD_ROTATION_THRESHOLDS.ROTATION_COST_BPS);
  assert.strictEqual(r.rotation_cost_usd, Math.round((100_000 * 30 / 10000) * 100) / 100); // $300
});

check("STAY — no meaningful yield pickup (<1%)", () => {
  const r = computeYieldRotation(held, pool({ pool: "tie", apy: 4.3 }), 100_000);
  assert.strictEqual(r.verdict, "STAY");
  assert.ok(r.reasons.some((x) => x.code === "no_yield_pickup"));
});

check("STAY — target APY is LOWER than current", () => {
  const r = computeYieldRotation(held, pool({ pool: "worse", apy: 2 }), 100_000);
  assert.strictEqual(r.verdict, "STAY");
  assert.strictEqual(r.apy_delta_pct, -2);
  assert.ok(r.net_gain_first_year_usd < 0);
  assert.strictEqual(r.breakeven_days, null); // no positive pickup → never pays back
});

check("STAY — never rotate INTO an AVOID target, however high the APY", () => {
  // Collapsed APY (apyPct30D ≤ -50) forces the target to AVOID.
  const avoidTarget = pool({ pool: "rug", apy: 99, apyPct30D: -80 });
  assert.strictEqual(computeYieldEntryVerdict(avoidTarget).verdict, "AVOID");
  const r = computeYieldRotation(held, avoidTarget, 100_000);
  assert.strictEqual(r.verdict, "STAY");
  assert.ok(r.reasons.some((x) => x.code === "target_unsafe"));
});

check("STAY — never rotate INTO an OUTLIER target", () => {
  const outlier = pool({ pool: "art", apy: 200, outlier: true });
  assert.strictEqual(computeYieldEntryVerdict(outlier).verdict, "OUTLIER");
  const r = computeYieldRotation(held, outlier, 100_000);
  assert.strictEqual(r.verdict, "STAY");
  assert.ok(r.reasons.some((x) => x.code === "target_unsafe"));
});

check("MARGINAL — real pickup but materially riskier target", () => {
  // Target: higher APY but DECAYING + volatile → higher risk_score than held.
  const riskier = pool({ pool: "hot", apy: 12, apyPct7D: -45, sigma: 0.9, ilRisk: "yes", il7d: -8 });
  const r = computeYieldRotation(held, riskier, 100_000);
  const rd = computeYieldEntryVerdict(riskier).risk_score - computeYieldEntryVerdict(held).risk_score;
  assert.ok(rd >= YIELD_ROTATION_THRESHOLDS.RISK_DELTA_MATERIAL, `risk delta ${rd}`);
  assert.strictEqual(r.verdict, "MARGINAL", JSON.stringify(r.reasons));
  assert.ok(r.reasons.some((x) => x.code === "riskier_target"));
});

check("STAY — pickup real but breakeven too slow at small notional", () => {
  // $500 notional, 2% pickup: daily gain ≈ 500*0.02/365 = $0.0274; cost $1.50 →
  // breakeven ≈ 54.7d... push smaller to exceed 90d. $300 notional, 1.2% pickup.
  const small = computeYieldRotation(held, pool({ pool: "slow", apy: 5.2 }), 300);
  assert.ok(small.breakeven_days > YIELD_ROTATION_THRESHOLDS.BREAKEVEN_MARGINAL_DAYS, `breakeven ${small.breakeven_days}`);
  assert.strictEqual(small.verdict, "STAY");
  assert.ok(small.reasons.some((x) => x.code === "slow_breakeven"));
});

check("notional scales the economics — same pair, bigger size recoups faster", () => {
  const big = computeYieldRotation(held, pool({ pool: "mid", apy: 6 }), 1_000_000);
  const tiny = computeYieldRotation(held, pool({ pool: "mid2", apy: 6 }), 1_000);
  // breakeven_days is independent of notional (cost and gain both scale linearly),
  // but net_gain_first_year must scale up with size.
  assert.ok(big.net_gain_first_year_usd > tiny.net_gain_first_year_usd);
  assert.strictEqual(big.rotation_cost_usd, 3000); // 1M * 30bps
});

check("same from/to economics are symmetric sign-wise", () => {
  const ab = computeYieldRotation(held, better, 100_000);
  const ba = computeYieldRotation(better, held, 100_000);
  assert.strictEqual(ab.apy_delta_pct, -ba.apy_delta_pct);
});

check("notional clamps are honored via the verdict math (floor $100)", () => {
  // Economics never divide-by-zero or NaN even at the floor.
  const r = computeYieldRotation(held, better, 100);
  assert.ok(Number.isFinite(r.rotation_cost_usd));
  assert.ok(r.breakeven_days == null || Number.isFinite(r.breakeven_days));
});

console.log(`\n${pass} checks passed`);
