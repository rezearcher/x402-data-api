import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_BASE,
  BASE_USDC,
  normalizeCoins,
  buildYieldsUrl,
  buildYieldsPreviewUrl,
  buildPricesUrl,
  buildPricesPreviewUrl,
  buildBalanceUrl,
  buildGasPriceUrl,
  buildGasPricePreviewUrl,
  buildBlockNumberUrl,
  buildBlockNumberPreviewUrl,
  buildTokenBalanceUrl,
  buildTokenBalancePreviewUrl,
  summarizeYields,
  summarizePrices,
  summarizeBalance,
  summarizeGasPrice,
  summarizeBlockNumber,
  summarizeTokenBalance,
  fundOnrampHint,
  runYields,
  runPrices,
  runBalance,
  runGasPrice,
  runBlockNumber,
  runTokenBalance,
  buildFundingUrl,
  buildFundingPreviewUrl,
  buildMarketBriefUrl,
  summarizeFunding,
  summarizeMarketBrief,
  runFunding,
  runMarketBrief,
  DEMO_TOKEN,
  buildTokenReportUrl,
  buildTokenReportPreviewUrl,
  summarizeTokenReport,
  runTokenReport,
} from "../src/data.mjs";

const ADDR = "0x4200000000000000000000000000000000000006";
const HOLDER = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";

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
  assert.throws(() => normalizeCoins("BAD ID!"), /invalid coingecko/); // spaces/punct rejected
  assert.throws(() => normalizeCoins(Array(26).fill("x")), /at most 25/);
});

test("normalizeCoins maps ticker symbols + uppercase to CoinGecko ids", () => {
  assert.deepEqual(normalizeCoins("ETH,BTC"), ["ethereum", "bitcoin"]);
  assert.deepEqual(normalizeCoins("eth, btc, sol"), ["ethereum", "bitcoin", "solana"]);
  assert.deepEqual(normalizeCoins("BITCOIN"), ["bitcoin"]); // uppercase id now lowercased, not rejected
  assert.deepEqual(normalizeCoins(["WETH", "aero"]), ["weth", "aerodrome-finance"]);
  assert.deepEqual(normalizeCoins("some-new-token"), ["some-new-token"]);
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

// ==========================================================================
// Base-RPC read routes: gas-price, block-number, token-balance
// ==========================================================================

// ---- URL builders ----
test("gas-price / block-number URL builders target the right routes", () => {
  assert.equal(buildGasPriceUrl(), `${DATA_BASE}/chain/gas-price`);
  assert.equal(buildGasPricePreviewUrl(), `${DATA_BASE}/chain/gas-price/preview`);
  assert.equal(buildBlockNumberUrl(), `${DATA_BASE}/chain/block-number`);
  assert.equal(buildBlockNumberPreviewUrl(), `${DATA_BASE}/chain/block-number/preview`);
});

test("buildTokenBalanceUrl validates, defaults token to USDC", () => {
  const u = buildTokenBalanceUrl({ address: HOLDER });
  assert.ok(u.startsWith(`${DATA_BASE}/chain/token-balance?`));
  assert.ok(u.includes(`address=${HOLDER}`));
  assert.ok(u.includes(encodeURIComponent(BASE_USDC)));
  assert.ok(buildTokenBalancePreviewUrl({ address: HOLDER }).startsWith(`${DATA_BASE}/chain/token-balance/preview?`));
  assert.throws(() => buildTokenBalanceUrl({ address: "0xdead" }), /invalid Base address/);
  assert.throws(() => buildTokenBalanceUrl({ address: HOLDER, token: "0xdead" }), /invalid Base token/);
});

// ---- summarisers ----
test("summarizeGasPrice renders gas/base/priority", () => {
  const s = summarizeGasPrice({ gas_price_gwei: 0.006, base_fee_gwei: 0.005, priority_fee_gwei: 0.001 });
  assert.match(s, /^Base /);
  assert.match(s, /gas /);
  assert.match(s, /gwei/);
  assert.equal(summarizeGasPrice({}), "no gas price");
});

test("summarizeBlockNumber renders the block height", () => {
  assert.match(summarizeBlockNumber({ block_number: 53190830 }), /block #53,190,830/);
  assert.equal(summarizeBlockNumber({}), "no block number");
});

test("summarizeTokenBalance renders amount + symbol + short addr", () => {
  const s = summarizeTokenBalance({ address: HOLDER, symbol: "USDC", balance: 33.11324, balance_formatted: "33.11324" });
  assert.match(s, /0x5765ae06…/);
  assert.match(s, /33\.11324 USDC/);
  assert.equal(summarizeTokenBalance({}), "no token balance");
});

// ---- runners: PAID path ----
test("runGasPrice paid returns gas object + summary + paid:true", async () => {
  const body = { gas_price_wei: "6000000", gas_price_gwei: 0.006, base_fee_gwei: 0.005, priority_fee_gwei: 0.001, chain: "base" };
  const out = await runGasPrice(payStub(jsonResponse(body)), {}, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.gas_price_gwei, 0.006);
  assert.match(out.summary, /^Base /);
  assert.equal(out.activation, undefined);
});

test("runBlockNumber paid returns block + summary + paid:true", async () => {
  const out = await runBlockNumber(payStub(jsonResponse({ block_number: 53190830, chain: "base" })), {}, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.block_number, 53190830);
  assert.match(out.summary, /53,190,830/);
});

test("runTokenBalance paid returns balance + summary + paid:true", async () => {
  const body = { address: HOLDER, token: BASE_USDC, symbol: "USDC", decimals: 6, balance: 33.11324, balance_formatted: "33.11324", chain: "base" };
  const out = await runTokenBalance(payStub(jsonResponse(body)), { address: HOLDER }, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.balance, 33.11324);
  assert.match(out.summary, /33\.11324 USDC/);
});

// ---- runners: keyless path returns the REAL preview value (identical to paid, never a stub) ----
test("runGasPrice keyless reads the identical free preview as REAL data", async () => {
  const previewFetch = async () => jsonResponse({ gas_price_gwei: 0.006, base_fee_gwei: 0.005, priority_fee_gwei: 0.001, chain: "base", note: "free" });
  const out = await runGasPrice(payStub(jsonResponse({})), {}, { hasKey: false, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.gas_price_gwei, 0.006); // REAL value, not fabricated/stubbed
  assert.ok(out.activation && out.activation.needed);
  assert.equal(out.activation.price_usdc, "0.002");
  assert.match(out.activation.reason, /identical full data/);
});

test("runBlockNumber keyless reads the identical free preview as REAL data", async () => {
  const previewFetch = async () => jsonResponse({ block_number: 53190830, chain: "base" });
  const out = await runBlockNumber(payStub(jsonResponse({})), {}, { hasKey: false, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.block_number, 53190830);
  assert.ok(out.activation.needed);
});

test("runTokenBalance keyless reads REAL balance via preview (never fabricated)", async () => {
  const previewFetch = async () => jsonResponse({ address: HOLDER, token: BASE_USDC, symbol: "USDC", balance: 33.11324, balance_formatted: "33.11324", chain: "base" });
  const out = await runTokenBalance(payStub(jsonResponse({})), { address: HOLDER }, { hasKey: false, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.balance, 33.11324); // real
  assert.ok(out.activation.needed);
  assert.match(out.activation.reason, /real balance/);
});

// ---- runners: degrade-open on 402, and never throw ----
test("runGasPrice degrades open on a 402 to the identical preview", async () => {
  const previewFetch = async () => jsonResponse({ gas_price_gwei: 0.006, chain: "base" });
  const out = await runGasPrice(payStub(jsonResponse(null, 402)), {}, { hasKey: true, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.gas_price_gwei, 0.006);
  assert.match(out.activation.reason, /402/);
});

test("runGasPrice true outage returns {error}, never throws", async () => {
  const boom = async () => { throw new Error("rpc down"); };
  const out = await runGasPrice(boom, {}, { hasKey: false, previewFetch: boom });
  assert.match(out.error, /rpc down/);
  assert.match(out.summary, /^ERROR:/);
});

test("runTokenBalance bad address surfaces as {error}, never throws", async () => {
  const out = await runTokenBalance(payStub(jsonResponse({})), { address: "0xdead" }, { hasKey: true });
  assert.match(out.error, /invalid Base address/);
  assert.equal(out.paid, false);
});

// ---- market-intelligence routes: perp funding + market brief ----

test("buildFundingUrl clamps limit; preview + brief URLs are param-free", () => {
  const u = buildFundingUrl({ limit: 999 });
  assert.ok(u.startsWith(`${DATA_BASE}/crypto/funding?`));
  assert.ok(u.includes("limit=100")); // clamped
  assert.equal(buildFundingPreviewUrl(), `${DATA_BASE}/crypto/funding/preview`);
  assert.equal(buildMarketBriefUrl(), `${DATA_BASE}/brief/market`);
});

test("summarizeFunding renders top coin, arb spread, signal + venues", () => {
  const rows = [{ coin: "BTC", funding_spread_bps: 1.03, signal: "LONGS_PAY", best_long_venue: "dydx", best_short_venue: "okx" }];
  const s = summarizeFunding(rows);
  assert.match(s, /BTC/);
  assert.match(s, /1\.03bps/);
  assert.match(s, /LONGS_PAY/);
  assert.match(s, /long@dydx\/short@okx/);
  assert.equal(summarizeFunding([]), "no funding data");
});

test("summarizeMarketBrief renders sentiment, mcap, dominance, trending", () => {
  const out = { fear_greed: { value: 55, classification: "Greed" }, global: { total_market_cap_usd: 2.5e12, btc_dominance_pct: 58.3 }, trending: [{ symbol: "AERO" }] };
  const s = summarizeMarketBrief(out);
  assert.match(s, /F&G 55 \(Greed\)/);
  assert.match(s, /mcap \$2\.50T/);
  assert.match(s, /BTC dom 58\.3%/);
  assert.match(s, /trending AERO/);
  assert.equal(summarizeMarketBrief({}), "no market brief");
});

test("runFunding keyless degrades OPEN to the real top-1 preview sample", async () => {
  const previewFetch = async () => jsonResponse({ preview: [{ coin: "BTC", funding_spread_bps: 1.03, signal: "LONGS_PAY" }], total_available: 20 });
  const out = await runFunding(payStub(jsonResponse([])), {}, { hasKey: false, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.count, 1);
  assert.equal(out.funding[0].coin, "BTC");
  assert.equal(out.total_available, 20);
  assert.ok(out.activation.needed);
  assert.equal(out.activation.price_usdc, "0.004");
});

test("runFunding paid path returns the full array with paid:true", async () => {
  const rows = [{ coin: "BTC" }, { coin: "ETH" }, { coin: "SOL" }];
  const out = await runFunding(payStub(jsonResponse(rows)), { limit: 3 }, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.count, 3);
  assert.equal(out.activation, undefined);
});

test("runFunding degrades open on a 402 to the preview", async () => {
  const previewFetch = async () => jsonResponse({ preview: [{ coin: "BTC" }], total_available: 20 });
  const out = await runFunding(payStub(jsonResponse(null, 402)), {}, { hasKey: true, previewFetch });
  assert.equal(out.paid, false);
  assert.match(out.activation.reason, /402/);
});

test("runFunding true outage returns {error}, never throws", async () => {
  const boom = async () => { throw new Error("hl down"); };
  const out = await runFunding(boom, {}, { hasKey: false, previewFetch: boom });
  assert.match(out.error, /hl down/);
  assert.deepEqual(out.funding, []);
  assert.match(out.summary, /^ERROR:/);
});

test("runMarketBrief keyless returns an activation stub (no fabricated brief)", async () => {
  const out = await runMarketBrief(payStub(jsonResponse({})), {}, { hasKey: false });
  assert.equal(out.paid, false);
  assert.equal(out.fear_greed, undefined); // no fabricated data
  assert.ok(out.activation.needed);
  assert.equal(out.activation.price_usdc, "0.01");
  assert.ok(Array.isArray(out.guard_reasons));
});

test("runMarketBrief paid path returns the brief with a summary", async () => {
  const brief = { fear_greed: { value: 55, classification: "Greed" }, global: { total_market_cap_usd: 2.5e12, btc_dominance_pct: 58.3 }, trending: [{ symbol: "AERO" }] };
  const out = await runMarketBrief(payStub(jsonResponse(brief)), {}, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.fear_greed.value, 55);
  assert.match(out.summary, /F&G 55/);
});

test("runMarketBrief 402 returns activation (no data), never throws", async () => {
  const out = await runMarketBrief(payStub(jsonResponse(null, 402)), {}, { hasKey: true });
  assert.equal(out.paid, false);
  assert.match(out.activation.reason, /402/);
});

// ---- token-safety route: /chain/token-report ----
const SAFE_PREVIEW = {
  token: DEMO_TOKEN,
  token_meta: { symbol: "AERO", name: "Aerodrome", decimals: 18 },
  security: { isHoneypot: false, sellable: true, buyTaxBps: 0, sellTaxBps: 0 },
  liquidity: { wethPoolUsd: 1383288 },
  verdict: "SAFE",
  risk_score: 15,
  reasons: ["owner can mint new supply"],
};

test("buildTokenReportUrl defaults to the demo token and validates", () => {
  assert.equal(buildTokenReportUrl(), `${DATA_BASE}/chain/token-report?token=${DEMO_TOKEN}`);
  assert.match(buildTokenReportPreviewUrl({ token: ADDR }), /\/chain\/token-report\/preview\?token=0x4200/);
  assert.throws(() => buildTokenReportUrl({ token: "nope" }), /invalid Base token/);
});

test("summarizeTokenReport renders verdict + risk + symbol + reasons", () => {
  const s = summarizeTokenReport(SAFE_PREVIEW);
  assert.match(s, /AERO: SAFE/);
  assert.match(s, /risk 15\/100/);
  assert.match(s, /owner can mint/);
  assert.equal(summarizeTokenReport({ trial_exhausted: true }), "token-safety free trial exhausted for today (3/day/IP) — pay $0.01 for any token");
  assert.equal(summarizeTokenReport({ verdict: null, note: "x" }), "token report unavailable — x");
});

test("runTokenReport keyless reads the full free-preview verdict (real, not a stub)", async () => {
  const previewFetch = async () => jsonResponse(SAFE_PREVIEW);
  const out = await runTokenReport(payStub(jsonResponse({})), {}, { hasKey: false, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.verdict, "SAFE");
  assert.equal(out.risk_score, 15);
  assert.equal(out.symbol, "AERO");
  assert.deepEqual(out.reasons, ["owner can mint new supply"]);
  assert.ok(out.activation.needed);
  assert.equal(out.activation.price_usdc, "0.01");
});

test("runTokenReport paid path returns the verdict with paid:true, no activation", async () => {
  const out = await runTokenReport(payStub(jsonResponse({ ...SAFE_PREVIEW, verdict: "AVOID", risk_score: 85 })), { token: ADDR }, { hasKey: true });
  assert.equal(out.paid, true);
  assert.equal(out.verdict, "AVOID");
  assert.equal(out.risk_score, 85);
  assert.equal(out.activation, undefined);
});

test("runTokenReport degrades OPEN on a spent daily trial (429) — no fabricated verdict", async () => {
  const previewFetch = async () =>
    jsonResponse({ error: "free real-token trial exhausted (3/day/IP)", trial: { real_token_checks_left_today: 0 }, paid_url: `${DATA_BASE}/chain/token-report?token=${ADDR}` }, 429);
  const out = await runTokenReport(payStub(jsonResponse({})), { token: ADDR }, { hasKey: false, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.verdict, null); // never fabricates a verdict
  assert.equal(out.trial_exhausted, true);
  assert.match(out.paid_url, /\/chain\/token-report\?token=/);
  assert.match(out.summary, /trial exhausted/);
});

test("runTokenReport on a 402 falls back to the preview verdict", async () => {
  const previewFetch = async () => jsonResponse(SAFE_PREVIEW);
  const out = await runTokenReport(payStub(jsonResponse(null, 402)), { token: ADDR }, { hasKey: true, previewFetch });
  assert.equal(out.paid, false);
  assert.equal(out.verdict, "SAFE");
  assert.match(out.activation.reason, /402/);
});

test("runTokenReport bad token surfaces as {error}, never throws", async () => {
  const out = await runTokenReport(payStub(jsonResponse({})), { token: "0xnope" }, { hasKey: true });
  assert.match(out.error, /invalid Base token|unavailable/);
  assert.equal(out.verdict, null);
  assert.match(out.summary, /^ERROR:/);
});

test("runTokenReport true outage returns {error}, never throws", async () => {
  const boom = async () => { throw new Error("rpc down"); };
  const out = await runTokenReport(boom, { token: ADDR }, { hasKey: false, previewFetch: boom });
  assert.match(out.error, /rpc down/);
  assert.equal(out.verdict, null);
  assert.match(out.summary, /^ERROR:/);
});
