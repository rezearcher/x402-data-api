/**
 * Contract tests for computeArbVerdict (src/index.ts) — the pure core that turns
 * per-venue funding + per-venue open interest into the CEX<->DEX arb verdict for
 * /crypto/funding. The correctness moat over raw multi-venue feeds: a thin-book
 * venue printing an extreme funding rate must NOT name an unexecutable
 * best-long/best-short or inflate funding_spread_bps — it is screened out when
 * its OI is known and below the floor.
 *
 *   node tests/test_arb_verdict_oi_weight.mjs
 *
 * Locks: thin venue excluded from the verdict, unknown-OI venues kept
 * (degrade-open), fall back to raw set when screening leaves <2, spread math,
 * excluded_thin_venues reporting, oi_weighted flag.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { computeArbVerdict } = await import("../src/index.ts");

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log(`  ok  ${name}`);
};

const FLOOR = 1_000_000;

t("thin-book venue is excluded from the verdict (the moat)", () => {
  // gate prints an extreme 0.009 (9x a normal rate) on a near-empty $50k book.
  // A naive min/max would name gate best_short_venue and report a huge spread.
  const funding = { hyperliquid: 0.0000125, okx: 0.0000492, dydx: -0.0000087, binance: 0.00003, bybit: 0.000048, gate: 0.009 };
  const oiUsd = { hyperliquid: 2_900_000_000, okx: 2_697_000_000, dydx: 17_700_000, binance: null, bybit: null, gate: 50_000 };
  const v = computeArbVerdict(funding, oiUsd, FLOOR);
  // okx (0.0000492) is the richest non-thin venue once gate is screened out.
  assert.strictEqual(v.best_short_venue, "okx", `thin gate must not be best_short; got ${v.best_short_venue}`);
  assert.strictEqual(v.best_long_venue, "dydx");
  assert.ok(v.excluded_thin_venues.some((x) => x.venue === "gate" && x.open_interest_usd === 50_000), "gate reported excluded");
  assert.strictEqual(v.oi_weighted, true);
  // spread is over the screened set (okx 0.0000492 - dydx -0.0000087) ~= 0.58 bps,
  // NOT the ~90 bps a naive min/max with gate=0.009 would print.
  assert.ok(v.funding_spread_bps < 1, `screened spread small; got ${v.funding_spread_bps}`);
});

t("unknown-OI venues (geo-blocked Binance/Bybit) are kept, never excluded", () => {
  const funding = { hyperliquid: 0.00001, okx: 0.00002, dydx: null, binance: 0.00009, bybit: null, gate: null };
  const oiUsd = { hyperliquid: 2_000_000_000, okx: 1_500_000_000, dydx: null, binance: null, bybit: null, gate: null };
  const v = computeArbVerdict(funding, oiUsd, FLOOR);
  // binance has the highest rate and unknown OI -> must still win best_short.
  assert.strictEqual(v.best_short_venue, "binance");
  assert.strictEqual(v.excluded_thin_venues.length, 0);
  assert.strictEqual(v.oi_weighted, true);
});

t("degrade-open: screening to <2 venues falls back to raw set, oi_weighted=false", () => {
  // only two venues present, one is thin -> screened set would be 1 -> fall back.
  const funding = { hyperliquid: 0.00001, okx: null, dydx: null, binance: null, bybit: null, gate: 0.009 };
  const oiUsd = { hyperliquid: 2_000_000_000, okx: null, dydx: null, binance: null, bybit: null, gate: 50_000 };
  const v = computeArbVerdict(funding, oiUsd, FLOOR);
  assert.strictEqual(v.oi_weighted, false, "flagged not OI-screened");
  // verdict still formed over the raw set (hl vs gate) so callers get a value.
  assert.ok(v.funding_spread_bps !== null);
  assert.strictEqual(v.best_short_venue, "gate");
  // gate is still reported as thin so the caller knows the verdict is unscreened.
  assert.ok(v.excluded_thin_venues.some((x) => x.venue === "gate"));
});

t("fewer than 2 venues -> null verdict, no throw", () => {
  const funding = { hyperliquid: 0.00001, okx: null, dydx: null, binance: null, bybit: null, gate: null };
  const oiUsd = { hyperliquid: 2_000_000_000, okx: null, dydx: null, binance: null, bybit: null, gate: null };
  const v = computeArbVerdict(funding, oiUsd, FLOOR);
  assert.strictEqual(v.funding_spread_bps, null);
  assert.strictEqual(v.best_long_venue, null);
  assert.strictEqual(v.best_short_venue, null);
});

t("all venues deep -> none excluded, verdict over full set", () => {
  const funding = { hyperliquid: 0.0000125, okx: 0.0000492, dydx: -0.0000087, binance: 0.00003, bybit: 0.000048, gate: 0.00003 };
  const oiUsd = { hyperliquid: 2_900_000_000, okx: 2_697_000_000, dydx: 17_700_000, binance: null, bybit: null, gate: 2_283_000_000 };
  const v = computeArbVerdict(funding, oiUsd, FLOOR);
  assert.strictEqual(v.excluded_thin_venues.length, 0);
  assert.strictEqual(v.best_long_venue, "dydx");
  assert.strictEqual(v.best_short_venue, "okx");
  assert.strictEqual(v.oi_weighted, true);
  assert.ok(Math.abs(v.funding_spread_bps - 0.58) < 0.01, `spread ${v.funding_spread_bps}`);
});

console.log(`\n${pass} checks passed`);
