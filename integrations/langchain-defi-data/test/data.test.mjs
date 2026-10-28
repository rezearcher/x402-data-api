import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_BASE,
  normalizeCoins,
  buildYieldsUrl,
  buildYieldsPreviewUrl,
  buildPricesUrl,
  buildPricesPreviewUrl,
  buildBalanceUrl,
  summarizeYields,
  summarizePrices,
  summarizeBalance,
  fundOnrampHint,
  runYields,
  runPrices,
  runBalance,
} from "../src/data.mjs";

const ADDR = "0x4200000000000000000000000000000000000006";

// ---- helpers ----
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
/** payFetch stub returning a fixed response (or throwing). */
function payStub(resp) {
  return async () => (resp instanceof Error ? (() => { throw resp; })() : resp);
}

// ---- input normalisers ----
test("normalizeCoins accepts string + array, dedupes, validates", () => {
  assert.deepEqual(normalizeCoins("bitcoin,ethereum"), ["bitcoin", "ethereum"]);
  assert.deepEqual(normalizeCoins(["bitcoin", "bitcoin", "solana"]), ["bitcoin", "solana"]);
  assert.throws(() => normalizeCoins(""), /at least one/);
  assert.throws(() => normalizeCoins("BITCOIN"), /invalid coingecko/); // uppercase rejected
  assert.throws(() => normalizeCoins(Array(26).fill("x")), /at most 25/);
});

// ---- URL builders ----
test("buildYieldsUrl clamps limit and applies filters", () => {
  const u = buildYieldsUrl({ limit: 999, project: "aave-v3", chain: "Base", stable: true, sort: "risk_adjusted" });
  assert.ok(u.startsWith(`${DATA_BASE}/defi/yields?`));
  assert.ok(u.includes("limit=100")); // clamped
  assert.ok(u.includes("project=aave-v3"));
  assert.ok(u.includes("chain=Base"));
  assert.ok(u.includes("stable=true"));
  assert.ok(u.includes("sort=risk_adjusted"));
  // default sort normalises to tvl
  assert.ok(buildYieldsUrl({ sort: "weird" }).includes("sort=tvl"));
  assert.equal(buildYieldsPreviewUrl(), `${DATA_BASE}/defi/yields/preview`);
});

test("buildPricesUrl + preview validate and shape coins", () => {
  assert.ok(buildPricesUrl({ coins: "bitcoin,ethereum" }).includes("coins=bitcoin%2Cethereum"));
  assert.ok(buildPricesPreviewUrl({ coins: ["solana", "bitcoin"] }).includes("coins=solana"));
  assert.throws(() => buildPricesUrl({ coins: "BAD ID!" }), /invalid coingecko/);
});

test("buildBalanceUrl validates address", () => {
  assert.ok(buildBalanceUrl({ address: ADDR }).includes(`address=${ADDR}`));
  assert.throws(() => buildBalanceUrl({ address: "0xdead" }), /invalid Base address/);
});

// ---- summarisers ----
test("summarizeYields renders top pool + count", () => {
  const s = summarizeYields([
    { project: "aave-v3", chain: "Base", symbol: "USDC", apy: 5.234, tvlUsd: 1.2e9, ilRisk: "no" },
    { project: "x" },
  ]);
  assert.match(s, /^Top of 2:/);
  assert.match(s, /aave-v3 Base USDC/);
  assert.match(s, /5\.23% APY/);
  assert.match(s, /TVL \$1\.20B/);
  assert.equal(summarizeYields([]), "no yield pools");
});

test("summarizePrices renders symbol/price/change", () => {
  const s = summarizePrices([
    { id: "bitcoin", symbol: "BTC", price: 80807.48, change_24h: 1.1667 },
    { id: "ethereum", symbol: "ETH", price: 3200, change_24h: -2.1 },
  ]);
  assert.match(s, /BTC \$80,807 \(\+1\.17%\)/);
  assert.match(s, /ETH \$3,200 \(-2\.10%\)/);
  assert.equal(summarizePrices([]), "no prices");
});

test("summarizeBalance renders eth + usd + short addr", () => {
  const s = summarizeBalance({ address: ADDR, balance_eth: 1.2345678, balance_usd: 4050.5 });
  assert.match(s, /0x42000000…/);
  assert.match(s, /1\.2346 ETH/);
  assert.match(s, /\$4,051/);
  assert.equal(summarizeBalance({}), "no balance");
});

test("fundOnrampHint names PRIVATE_KEY and the free tier", () => {
  const h = fundOnrampHint();
  assert.match(h, /FREE preview/);
  assert.match(h, /PRIVATE_KEY/);
  assert.match(h, /x402/);
});

// ---- runners: PAID path ----
test("runYields paid returns array + summary + paid:true, no activation", async () => {
  const rows = [{ project: "lido", chain: "Ethereum", symbol: "STETH", apy: 2.27, tvlUsd: 2.2e10 }];
  const out = await runYields(payStub(jsonResponse(rows)), { limit: 20 }, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.count, 1);
  assert.match(out.summary, /lido/);
  assert.equal(out.activation, undefined);
});

test("runPrices paid returns array + summary + paid:true", async () => {
  const rows = [{ id: "bitcoin", symbol: "BTC", price: 80000, change_24h: 1.1 }];
  const out = await runPrices(payStub(jsonResponse(rows)), { coins: "bitcoin" }, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.prices.length, 1);
  assert.match(out.summary, /BTC/);
});

test("runBalance paid returns balance + summary", async () => {
  const body = { address: ADDR, balance_wei: "1000000000000000000", balance_eth: 1, balance_usd: 3200, chain: "base" };
  const out = await runBalance(payStub(jsonResponse(body)), { address: ADDR }, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.balance_eth, 1);
  assert.match(out.summary, /1\.0000 ETH/);
});

// ---- runners: DEGRADE-OPEN (keyless) path ----
test("runYields keyless reads the free preview + activation hint", async () => {
  const preview = jsonResponse({ preview: [{ project: "lido", symbol: "STETH", apy: 2.27, tvlUsd: 2.2e10 }], total_available: 20 });
  const previewFetch = async () => preview;
  const out = await runYields(payStub(jsonResponse([])), { limit: 20 }, { hasKey: false, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.count, 1);
  assert.equal(out.total_available, 20);
  assert.ok(out.activation && out.activation.needed);
  assert.equal(out.activation.price_usdc, "0.001");
  assert.match(out.activation.reason, /no PRIVATE_KEY/);
  assert.ok(out.guard_reasons[0].includes("FREE preview"));
});

test("runPrices keyless reads the free 1-of-N preview", async () => {
  const previewFetch = async () => jsonResponse({ preview: [{ id: "bitcoin", symbol: "BTC", price: 80000, change_24h: 1 }] });
  const out = await runPrices(payStub(jsonResponse([])), { coins: "bitcoin,ethereum" }, { hasKey: false, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.prices.length, 1);
  assert.ok(out.activation.needed);
});

test("runYields degrades open on a 402 (unfunded wallet) to the preview", async () => {
  const previewFetch = async () => jsonResponse({ preview: [{ project: "lido", symbol: "STETH", apy: 2.27 }], total_available: 20 });
  const out = await runYields(payStub(jsonResponse(null, 402)), { limit: 20 }, { hasKey: true, previewFetch });
  assert.equal(out.paid, false);
  assert.match(out.activation.reason, /402/);
});

// ---- runners: BALANCE has no preview → honest activation stub, never fabricated ----
test("runBalance keyless returns activation stub, NOT a fabricated balance", async () => {
  const out = await runBalance(payStub(jsonResponse({})), { address: ADDR }, { hasKey: false });
  assert.equal(out.paid, false);
  assert.equal(out.balance_eth, undefined); // no fabricated number
  assert.ok(out.activation.needed);
  assert.equal(out.activation.price_usdc, "0.002");
});

test("runBalance on 402 returns activation stub (not an error throw)", async () => {
  const out = await runBalance(payStub(jsonResponse(null, 402)), { address: ADDR }, { hasKey: true });
  assert.equal(out.paid, false);
  assert.match(out.activation.reason, /402/);
});

// ---- runners NEVER throw into the agent runtime; a true outage → {error} ----
test("runYields true outage returns {error}, never throws", async () => {
  const boom = async () => { throw new Error("network down"); };
  const out = await runYields(boom, { limit: 20 }, { hasKey: false, previewFetch: boom });
  assert.match(out.error, /network down/);
  assert.deepEqual(out.yields, []);
  assert.match(out.summary, /^ERROR:/);
});

test("runPrices bad coin id surfaces as {error}, never throws", async () => {
  const out = await runPrices(payStub(jsonResponse([])), { coins: "BAD ID" }, { hasKey: true });
  assert.match(out.error, /invalid coingecko/);
});
