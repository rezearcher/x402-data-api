/**
 * Contract tests for cexTickersToFundingMap (src/index.ts) — the pure core that
 * turns a CoinGecko /derivatives/exchanges/{id} tickers array into a
 * base-ticker -> funding-fraction map for the Binance+Bybit CEX venues added to
 * /crypto/funding (the 5-venue superset feed).
 *
 *   node tests/test_cex_funding_map.mjs
 *
 * Locks: USDT-quoted perpetuals only, funding_rate PERCENT -> fraction (/100),
 * first-row-per-base wins, bad/missing rows skipped, degrade-open on undefined.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { cexTickersToFundingMap } = await import("../src/index.ts");

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log(`  ok  ${name}`);
};

// Representative sample mirroring the real CoinGecko per-exchange shape.
const sample = [
  { base: "BTC", target: "USDT", contract_type: "perpetual", funding_rate: 0.003034 },
  { base: "ETH", target: "USDT", contract_type: "perpetual", funding_rate: 0.002221 },
  { base: "SOL", target: "USDT", contract_type: "perpetual", funding_rate: -0.005992 },
  // non-USDT quote -> excluded
  { base: "BTC", target: "USDC", contract_type: "perpetual", funding_rate: 0.9 },
  // non-perpetual -> excluded
  { base: "XRP", target: "USDT", contract_type: "futures", funding_rate: 0.01 },
  // duplicate base, USDT perp -> first wins, this is ignored
  { base: "BTC", target: "USDT", contract_type: "perpetual", funding_rate: 99 },
  // string funding_rate (parse) -> accepted
  { base: "DOGE", target: "USDT", contract_type: "perpetual", funding_rate: "0.01" },
  // non-finite funding -> skipped
  { base: "PEPE", target: "USDT", contract_type: "perpetual", funding_rate: null },
  { base: "WIF", target: "USDT", contract_type: "perpetual", funding_rate: "n/a" },
  // missing base -> skipped
  { base: "", target: "USDT", contract_type: "perpetual", funding_rate: 0.5 },
];

t("percent -> fraction (/100)", () => {
  const m = cexTickersToFundingMap(sample);
  assert.ok(Math.abs(m.get("BTC") - 0.00003034) < 1e-12, `BTC ${m.get("BTC")}`);
  assert.ok(Math.abs(m.get("ETH") - 0.00002221) < 1e-12, `ETH ${m.get("ETH")}`);
});

t("negative funding preserved", () => {
  const m = cexTickersToFundingMap(sample);
  assert.ok(Math.abs(m.get("SOL") - -0.00005992) < 1e-12, `SOL ${m.get("SOL")}`);
});

t("non-USDT quote excluded (no USDC leak)", () => {
  const m = cexTickersToFundingMap(sample);
  // BTC present but from the USDT row (0.003034%), never the 0.9% USDC row
  assert.notStrictEqual(m.get("BTC"), 0.009);
});

t("non-perpetual excluded", () => {
  const m = cexTickersToFundingMap(sample);
  assert.strictEqual(m.has("XRP"), false);
});

t("first row per base wins (dup BTC 99 ignored)", () => {
  const m = cexTickersToFundingMap(sample);
  assert.ok(m.get("BTC") < 0.001, `BTC should be the first small value, got ${m.get("BTC")}`);
});

t("string funding_rate parsed", () => {
  const m = cexTickersToFundingMap(sample);
  assert.ok(Math.abs(m.get("DOGE") - 0.0001) < 1e-12, `DOGE ${m.get("DOGE")}`);
});

t("non-finite / missing-base rows skipped", () => {
  const m = cexTickersToFundingMap(sample);
  assert.strictEqual(m.has("PEPE"), false);
  assert.strictEqual(m.has("WIF"), false);
  assert.strictEqual(m.has(""), false);
});

t("base upper-cased", () => {
  const m = cexTickersToFundingMap([
    { base: "btc", target: "usdt", contract_type: "perpetual", funding_rate: 0.01 },
  ]);
  assert.strictEqual(m.has("BTC"), true);
});

t("degrade-open on undefined/empty", () => {
  assert.strictEqual(cexTickersToFundingMap(undefined).size, 0);
  assert.strictEqual(cexTickersToFundingMap([]).size, 0);
});

console.log(`\n${pass} checks passed`);
