/**
 * Contract tests for parsePredictedFundings (src/index.ts) — the pure core that
 * turns Hyperliquid's `predictedFundings` payload into a
 * coin -> {binance, bybit, intervals} map for the Binance+Bybit CEX venues added
 * to /crypto/funding (the 5-venue superset feed). Hyperliquid is the keyless,
 * non-geoblocked, non-rate-limited bridge to those two CEX venues (their own APIs
 * geo-block datacenter egress; CoinGecko 429-throttles the shared Worker IP).
 *
 *   node tests/test_cex_funding_map.mjs
 *
 * Locks: BinPerp->binance, BybitPerp->bybit, native fractions, interval captured,
 * malformed rows skipped, degrade-open on non-array input.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { parsePredictedFundings } = await import("../src/index.ts");

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log(`  ok  ${name}`);
};

// Mirrors the real api.hyperliquid.xyz {type:predictedFundings} shape.
const sample = [
  ["BTC", [
    ["BinPerp", { fundingRate: "0.00002154", nextFundingTime: 1793260800000, fundingIntervalHours: 8 }],
    ["HlPerp", { fundingRate: "0.0000125", nextFundingTime: 1793239200000, fundingIntervalHours: 1 }],
    ["BybitPerp", { fundingRate: "0.00003362", nextFundingTime: 1793260800000, fundingIntervalHours: 8 }],
  ]],
  ["0G", [
    ["BinPerp", { fundingRate: "0.00005", fundingIntervalHours: 4 }],
    ["BybitPerp", { fundingRate: "0.00005", fundingIntervalHours: 4 }],
  ]],
  // coin with only Hyperliquid -> binance/bybit null
  ["WEIRD", [
    ["HlPerp", { fundingRate: "0.0000125", fundingIntervalHours: 1 }],
  ]],
  // malformed rows -> skipped without throwing
  ["BADVENUES", "not-an-array"],
  ["BADRATE", [["BinPerp", { fundingRate: "n/a", fundingIntervalHours: 8 }]]],
  "not-a-row",
  [],
];

t("BinPerp -> binance, BybitPerp -> bybit, native fraction", () => {
  const m = parsePredictedFundings(sample);
  const btc = m.get("BTC");
  assert.ok(Math.abs(btc.binance - 0.00002154) < 1e-12, `binance ${btc.binance}`);
  assert.ok(Math.abs(btc.bybit - 0.00003362) < 1e-12, `bybit ${btc.bybit}`);
});

t("funding interval captured", () => {
  const m = parsePredictedFundings(sample);
  assert.strictEqual(m.get("BTC").binanceIntervalH, 8);
  assert.strictEqual(m.get("0G").bybitIntervalH, 4);
});

t("coin without a CEX venue -> null", () => {
  const m = parsePredictedFundings(sample);
  const w = m.get("WEIRD");
  assert.strictEqual(w.binance, null);
  assert.strictEqual(w.bybit, null);
});

t("non-finite rate skipped", () => {
  const m = parsePredictedFundings(sample);
  assert.strictEqual(m.get("BADRATE").binance, null);
});

t("malformed rows don't throw and are skipped", () => {
  const m = parsePredictedFundings(sample);
  // Row whose venues field isn't an array is skipped entirely (not in map).
  assert.strictEqual(m.has("BADVENUES"), false);
  // But the well-formed rows around it still parsed.
  assert.ok(m.has("BTC") && m.has("0G"));
});

t("degrade-open on non-array / empty", () => {
  assert.strictEqual(parsePredictedFundings(undefined).size, 0);
  assert.strictEqual(parsePredictedFundings({}).size, 0);
  assert.strictEqual(parsePredictedFundings([]).size, 0);
});

console.log(`\n${pass} checks passed`);
