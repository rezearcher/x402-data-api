/**
 * Contract test for the per-pool DeFi yield-entry verdict route.
 *
 *   node tests/test_yield_entry_verdict.mjs
 *
 * /defi/yields is our #1-demand route (6 distinct external payers,
 * external_payer_routes.py 2026-10-28) and already returns the raw DefiLlama
 * fields (apyPct7D/30D, il7d, sigma, outlier, predictions) — but NO packaged
 * go/no-go. computeYieldEntryVerdict folds those OWN fields into a single
 * SUSTAINABLE | DECAYING | OUTLIER | AVOID verdict + 0-100 risk score +
 * field-cited reasons (no hardcoded pool list, pure + deterministic). This test
 * locks: (1) the verdict logic on fixtures, (2) the route is registered in
 * ROUTE_CATALOG at $0.01 so /.well-known/x402 advertises it (62→63) and
 * makeRoutes 402-gates it, (3) fetchDefiPoolById returns null (not throw) for an
 * unknown id, (4) see_also cross-sell fires for the new route.
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const {
  computeYieldEntryVerdict,
  YIELD_ENTRY_THRESHOLDS,
  fetchDefiPoolById,
  normalizeDefiLlamaPool,
  ROUTE_CATALOG,
  buildSeeAlso,
  makeRoutes,
} = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// A healthy baseline YieldPool — every flag clear; tweak per case.
function pool(over = {}) {
  return {
    project: "aave-v3", chain: "Base", symbol: "USDC", pool: "pool-fixture-1",
    apy: 5.2, apyBase: 5.2, apyReward: null,
    apyPct1D: 0.1, apyPct7D: 0.3, apyPct30D: -1.2,
    apyBase7d: 5.0, apyMean30d: 5.1,
    tvlUsd: 25_000_000, stablecoin: true, ilRisk: "no", il7d: null,
    exposure: "single", outlier: false, rewardTokens: null, underlyingTokens: null,
    mu: 5.1, sigma: 0.08, risk_adjusted_apy: 65,
    predicted_probability: 70, predicted_class: "Stable/Up", volumeUsd1d: null,
    ...over,
  };
}

// (1) Healthy stable pool → SUSTAINABLE, risk 0, single reason.
{
  const r = computeYieldEntryVerdict(pool());
  eq(r.verdict, "SUSTAINABLE", "healthy pool is SUSTAINABLE");
  eq(r.risk_score, 0, "healthy pool risk_score 0");
  eq(r.reasons.length, 1, "healthy pool emits exactly one (sustainable) reason");
  eq(r.reasons[0].code, "stable_sustainable", "healthy reason code");
  eq(r.predicted.class, "Stable/Up", "forecast class surfaced");
  eq(r.pool, "pool-fixture-1", "pool id echoed");
}

// (2) DefiLlama outlier flag → OUTLIER (worst), cites outlier field.
{
  const r = computeYieldEntryVerdict(pool({ outlier: true, apy: 9999 }));
  eq(r.verdict, "OUTLIER", "outlier flag → OUTLIER");
  ok(r.risk_score >= 45, "outlier risk_score high");
  ok(r.reasons.some((x) => x.field === "outlier"), "outlier reason cites outlier field");
}

// (3) apyPct7D -80 → DECAYING (trend down, not collapsed 30d).
{
  const r = computeYieldEntryVerdict(pool({ apyPct7D: -80, apyPct30D: -10 }));
  eq(r.verdict, "DECAYING", "apyPct7D -80 → DECAYING");
  ok(r.reasons.some((x) => x.field === "apyPct7D" && x.code === "apy_decaying_7d"), "7d decay reason cites apyPct7D");
}

// (4) apyPct30D -60 → AVOID (APY collapsed).
{
  const r = computeYieldEntryVerdict(pool({ apyPct30D: -60 }));
  eq(r.verdict, "AVOID", "apyPct30D -60 → AVOID");
  ok(r.reasons.some((x) => x.code === "apy_collapsed_30d" && x.field === "apyPct30D"), "collapse reason cites apyPct30D");
}

// (5) predictedClass Down @ high confidence → AVOID.
{
  const r = computeYieldEntryVerdict(pool({ predicted_class: "Down", predicted_probability: 75 }));
  eq(r.verdict, "AVOID", "Down forecast high-conf → AVOID");
  ok(r.reasons.some((x) => x.code === "forecast_down_high_conf" && x.field === "predicted_class"), "forecast-down reason cites predicted_class");
}

// (6) Thin TVL → AVOID (exit-liquidity risk), cites tvlUsd.
{
  const r = computeYieldEntryVerdict(pool({ tvlUsd: 10_000 }));
  eq(r.verdict, "AVOID", "sub-threshold TVL → AVOID");
  ok(r.reasons.some((x) => x.code === "illiquid_tvl" && x.field === "tvlUsd"), "illiquid reason cites tvlUsd");
}

// (7) Material impermanent loss drags an otherwise-healthy pool to DECAYING.
{
  const r = computeYieldEntryVerdict(pool({ il7d: -12, ilRisk: "yes" }));
  eq(r.verdict, "DECAYING", "material il7d → at least DECAYING");
  ok(r.reasons.some((x) => x.code === "impermanent_loss" && x.field === "il7d"), "IL reason cites il7d");
}

// (8) Degrade-open: never throws on all-null fields; verdict is a valid enum.
{
  const bare = pool({ apy: null, apyPct7D: null, apyPct30D: null, il7d: null, sigma: null, predicted_class: null, predicted_probability: null, tvlUsd: 25_000_000, ilRisk: "unknown", outlier: false });
  const r = computeYieldEntryVerdict(bare);
  ok(["SUSTAINABLE", "DECAYING", "OUTLIER", "AVOID"].includes(r.verdict), "all-null pool yields a valid verdict enum");
  ok(Number.isFinite(r.risk_score) && r.risk_score >= 0 && r.risk_score <= 100, "risk_score bounded 0-100");
}

// (9) Thresholds are named constants (no magic numbers buried in logic).
{
  ok(typeof YIELD_ENTRY_THRESHOLDS.APY_30D_COLLAPSE === "number", "APY_30D_COLLAPSE is a named constant");
  ok(YIELD_ENTRY_THRESHOLDS.TVL_ILLIQUID > 0, "TVL_ILLIQUID named constant");
}

// (10) Route registered in ROUTE_CATALOG at $0.01, tagged data (so it is
//      discoverable + see_also-eligible), raising the manifest to 63 resources.
{
  const row = ROUTE_CATALOG.find((r) => r[0] === "/defi/yield-entry-verdict");
  ok(!!row, "/defi/yield-entry-verdict is in ROUTE_CATALOG");
  eq(row[1], "GET", "catalog method GET");
  eq(row[2], "0.01", "catalog price 0.01");
  ok(row[5].includes("data"), "tagged data");
  ok(row[5].includes("defi"), "tagged defi");
  ok(ROUTE_CATALOG.length >= 63, "catalog has at least 63 rows (yield-entry-verdict present)");
}

// (11) makeRoutes 402-gates the route at $0.01 (payment middleware source).
{
  const routes = makeRoutes("0x0000000000000000000000000000000000000001");
  const def = routes["GET /defi/yield-entry-verdict"];
  ok(!!def, "makeRoutes advertises GET /defi/yield-entry-verdict");
  eq(def.accepts.price, "$0.01", "402 challenge price is $0.01");
}

// (12) see_also cross-sell fires for the new route: a DATA buyer gets the
//      flagship safety verdict + a top-demand data sibling (never self).
{
  const sa = buildSeeAlso("/defi/yield-entry-verdict");
  ok(sa.length >= 1, "see_also returns at least one entry for the new route");
  ok(sa.every((e) => !e.resource.endsWith("/defi/yield-entry-verdict")), "see_also never points back at self");
  ok(sa.some((e) => e.resource.includes("/chain/token-report")), "see_also promotes the flagship token-report safety verdict");
}

// (13) fetchDefiPoolById returns null (NOT throw) for an unknown id, and a
//      normalized pool (with predicted_class) for a known id — degrade-open.
{
  const fakePools = {
    status: "success",
    data: [{
      chain: "Base", project: "aerodrome", symbol: "WETH-USDC", tvlUsd: 1_000_000,
      apyBase: 3, apyReward: 1, apy: 4, apyPct1D: 0, apyPct7D: -2, apyPct30D: -5,
      apyBase7d: 3, apyMean30d: 4, pool: "known-id-123", stablecoin: false,
      ilRisk: "yes", il7d: -1.2, exposure: "multi", volumeUsd1d: 50000,
      outlier: false, rewardTokens: null, underlyingTokens: null, mu: 4, sigma: 0.2,
      predictions: { predictedProbability: 65, predictedClass: "Down" },
    }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => fakePools });
  try {
    const miss = await fetchDefiPoolById("does-not-exist");
    eq(miss, null, "unknown poolId → null (degrade-open, no throw)");
    const hit = await fetchDefiPoolById("known-id-123");
    ok(hit && hit.pool === "known-id-123", "known poolId resolves");
    eq(hit.predicted_class, "Down", "predicted_class carried through normalize");
    // and the verdict pipeline runs end-to-end on it without throwing
    const v = computeYieldEntryVerdict(hit);
    ok(["SUSTAINABLE", "DECAYING", "OUTLIER", "AVOID"].includes(v.verdict), "verdict computed for the fetched pool");
  } finally {
    globalThis.fetch = realFetch;
  }
}

// (14) normalizeDefiLlamaPool maps predictedClass → predicted_class (the field
//      the verdict reads) — the drift-proofing reason it was extracted.
{
  const y = normalizeDefiLlamaPool({
    chain: "Base", project: "x", symbol: "Y", tvlUsd: 1, apyBase: null, apyReward: null,
    apy: 1, apyPct1D: null, apyPct7D: null, apyPct30D: null, apyBase7d: null, apyMean30d: null,
    pool: "p", stablecoin: false, ilRisk: "no", il7d: null, exposure: "single",
    volumeUsd1d: null, outlier: false, rewardTokens: null, underlyingTokens: null,
    mu: null, sigma: null, predictions: { predictedProbability: 80, predictedClass: "Stable/Up" },
  });
  eq(y.predicted_class, "Stable/Up", "predictedClass → predicted_class");
  eq(y.predicted_probability, 80, "predictedProbability → predicted_probability");
}

console.log(`test_yield_entry_verdict: ${pass} checks passed`);
