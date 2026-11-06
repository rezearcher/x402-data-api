// Pure, dependency-free core for the Grey Ridge DeFi/market data tools.
// No AI SDK and no x402 imports live here so the fetch + shaping logic can be
// unit-tested offline and against the live endpoints without the agent runtime.
//
// These wrap our OWN live x402 routes (near-100% margin, DefiLlama/Base-RPC
// upstream, sub-cent Cloudflare Worker): /defi/yields ($0.001),
// /crypto/prices ($0.001) and /chain/balance ($0.002). They are the DATA lane
// — the routes external agents actually pay for — not the pre-trade safety gate.

export const DATA_BASE = "https://x402-data-api.sigrunner.workers.dev";

const ADDR_RE = /0x[a-fA-F0-9]{40}/;
const COINGECKO_ID_RE = /^[a-z0-9-]{1,40}$/;

// Common ticker-symbol → CoinGecko id aliases, mirrored from the server so the
// client accepts the same input the API does. An LLM asked "what's ETH trading
// at" calls with "ETH", not the slug "ethereum" — without this the most natural
// query threw before any request. Unknown symbols pass through lowercased so a
// real CoinGecko id still resolves (degrade-open), never a silent gate.
const COIN_ALIASES = {
  btc: "bitcoin", eth: "ethereum", weth: "weth", sol: "solana", bnb: "binancecoin",
  xrp: "ripple", ada: "cardano", doge: "dogecoin", avax: "avalanche-2", dot: "polkadot",
  matic: "matic-network", pol: "matic-network", link: "chainlink", uni: "uniswap",
  ltc: "litecoin", trx: "tron", atom: "cosmos", near: "near", apt: "aptos",
  arb: "arbitrum", op: "optimism", usdc: "usd-coin", usdt: "tether", dai: "dai",
  wbtc: "wrapped-bitcoin", cbbtc: "coinbase-wrapped-btc", steth: "staked-ether",
  aave: "aave", mkr: "maker", ldo: "lido-dao", crv: "curve-dao-token", snx: "havven",
  comp: "compound-governance-token", aero: "aerodrome-finance", degen: "degen-base",
  pepe: "pepe", shib: "shiba-inu", ena: "ethena", sui: "sui", ton: "the-open-network",
  hype: "hyperliquid",
};

// --------------------------------------------------------------------------
// Input normalisers
// --------------------------------------------------------------------------

/** Normalise `coins` (string "a,b" or string[]) to a validated, de-duped id list, mapping ticker symbols (ETH, BTC) to CoinGecko ids. Throws on a bad id so a bad call never silently costs a payment. */
export function normalizeCoins(coins) {
  const raw = Array.isArray(coins)
    ? coins
    : String(coins || "")
        .split(",")
        .map((s) => s.trim());
  const ids = raw
    .filter(Boolean)
    .map((s) => {
      const k = s.toLowerCase();
      return COIN_ALIASES[k] ?? k;
    });
  if (ids.length === 0) throw new Error("coins must contain at least one CoinGecko id or ticker symbol");
  if (ids.length > 25) throw new Error("coins accepts at most 25 ids");
  const bad = ids.filter((id) => !COINGECKO_ID_RE.test(id));
  if (bad.length) throw new Error(`invalid coingecko id(s): ${bad.join(", ")}`);
  return [...new Set(ids)];
}

function clampLimit(limit, def = 20, max = 100) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

// --------------------------------------------------------------------------
// URL builders
// --------------------------------------------------------------------------

/** Build the paid /defi/yields URL with optional filters. */
export function buildYieldsUrl({ limit = 20, project, chain, stable, sort = "tvl", base = DATA_BASE } = {}) {
  const qs = new URLSearchParams({ limit: String(clampLimit(limit)) });
  if (project) qs.set("project", String(project));
  if (chain) qs.set("chain", String(chain));
  if (stable === true || stable === "true") qs.set("stable", "true");
  qs.set("sort", sort === "risk_adjusted" ? "risk_adjusted" : "tvl");
  return `${base}/defi/yields?${qs.toString()}`;
}

/** Build the FREE /defi/yields/preview URL (top-1 sample; filters are ignored upstream but kept for parity). */
export function buildYieldsPreviewUrl({ base = DATA_BASE } = {}) {
  return `${base}/defi/yields/preview`;
}

/** Build the paid /crypto/prices URL. Throws on a malformed coin id. */
export function buildPricesUrl({ coins, base = DATA_BASE } = {}) {
  const ids = normalizeCoins(coins);
  const qs = new URLSearchParams({ coins: ids.join(",") });
  return `${base}/crypto/prices?${qs.toString()}`;
}

/** Build the FREE /crypto/prices/preview URL (1-of-N sample for the first requested coin). */
export function buildPricesPreviewUrl({ coins, base = DATA_BASE } = {}) {
  const ids = normalizeCoins(coins);
  const qs = new URLSearchParams({ coins: ids[0] });
  return `${base}/crypto/prices/preview?${qs.toString()}`;
}

/** Build the paid /chain/balance URL. Throws on a malformed address. */
export function buildBalanceUrl({ address, base = DATA_BASE } = {}) {
  if (!ADDR_RE.test(String(address || ""))) throw new Error(`invalid Base address: ${address}`);
  const qs = new URLSearchParams({ address });
  return `${base}/chain/balance?${qs.toString()}`;
}

// --------------------------------------------------------------------------
// Summarisers — one-line human strings the model can relay verbatim
// --------------------------------------------------------------------------

function usd(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(abs < 1 ? 4 : 2)}`;
}

/** One-line summary of a /defi/yields array (top pool + count). */
export function summarizeYields(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "no yield pools";
  const t = rows[0];
  const bits = [];
  const label = [t.project, t.chain, t.symbol].filter(Boolean).join(" ");
  if (label) bits.push(label);
  if (typeof t.apy === "number") bits.push(`${t.apy.toFixed(2)}% APY`);
  const tvl = usd(t.tvlUsd);
  if (tvl) bits.push(`TVL ${tvl}`);
  if (t.ilRisk && t.ilRisk !== "no") bits.push(`IL risk ${t.ilRisk}`);
  return `Top of ${rows.length}: ${bits.join(" · ") || "pool"}`;
}

/** One-line summary of a /crypto/prices array. */
export function summarizePrices(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "no prices";
  return rows
    .slice(0, 4)
    .map((p) => {
      const sym = p.symbol || p.id;
      const price = usd(p.price);
      const chg =
        typeof p.change_24h === "number"
          ? ` (${p.change_24h >= 0 ? "+" : ""}${p.change_24h.toFixed(2)}%)`
          : "";
      return `${sym} ${price}${chg}`;
    })
    .join(" · ");
}

/** One-line summary of a /chain/balance object. */
export function summarizeBalance(out) {
  if (!out || typeof out !== "object" || out.balance_eth == null) return "no balance";
  const eth = Number(out.balance_eth);
  const u = usd(out.balance_usd);
  const addr = out.address ? `${String(out.address).slice(0, 10)}…` : "address";
  return `${addr} holds ${eth.toFixed(4)} ETH${u ? ` (${u})` : ""} on Base`;
}

// --------------------------------------------------------------------------
// Activation hint — shown when running WITHOUT a funded wallet
// --------------------------------------------------------------------------

/** One-line onboarding hint for the keyless / unfunded free tier. */
export function fundOnrampHint() {
  return (
    "Grey Ridge data tools are running in FREE preview mode: you get a 1-row " +
    "sample. To unlock full results (up to 25 prices, 100 ranked yield pools, " +
    "and live Base balances), set PRIVATE_KEY to a Base wallet holding ~1 USDC " +
    "(covers ~1000 calls at $0.001 each, paid inline per call via x402 — no API " +
    "key, no subscription)."
  );
}

function activationBlock(reason, { paidUrl, priceUsdc }) {
  return {
    needed: true,
    mode: "free_preview",
    reason,
    hint: fundOnrampHint(),
    paid_url: paidUrl,
    price_usdc: priceUsdc,
  };
}

// --------------------------------------------------------------------------
// Fetch + degrade-open
// --------------------------------------------------------------------------

async function plainGet(previewFetch, url) {
  const f = previewFetch || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("no fetch available");
  const res = await f(url);
  if (!res.ok && res.status !== 200) throw new Error(`preview failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch /defi/yields, DEGRADING OPEN to the free top-1 preview when the paid
 * call cannot be paid (no PRIVATE_KEY, or an unfunded wallet → 402). The sample
 * is a real ranked pool; only the depth (up to 100 ranked pools) is withheld.
 * Returns `{ yields, paid, activation? }`. Throws only when BOTH the paid route
 * and the preview are unreachable — a true outage the caller surfaces as error.
 */
export async function fetchYieldsOrPreview(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  const paidUrl = buildYieldsUrl(args);
  const takePreview = async (reason) => {
    const out = await plainGet(previewFetch, buildYieldsPreviewUrl(args));
    const yields = Array.isArray(out?.preview) ? out.preview : [];
    return { yields, paid: false, total_available: out?.total_available, activation: activationBlock(reason, { paidUrl, priceUsdc: "0.001" }) };
  };
  if (!hasKey) return takePreview("no PRIVATE_KEY configured");
  const res = await payFetch(paidUrl);
  if (res.ok || res.status === 200) {
    const out = await res.json();
    return { yields: Array.isArray(out) ? out : [], paid: true };
  }
  const reason = res.status === 402 ? "wallet not funded (paid /defi/yields returned 402)" : `paid /defi/yields returned HTTP ${res.status}`;
  return takePreview(reason);
}

/** Fetch /crypto/prices, degrading open to the free 1-of-N preview. Returns `{ prices, paid, activation? }`. */
export async function fetchPricesOrPreview(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  const paidUrl = buildPricesUrl(args);
  const takePreview = async (reason) => {
    const out = await plainGet(previewFetch, buildPricesPreviewUrl(args));
    const prices = Array.isArray(out?.preview) ? out.preview : [];
    return { prices, paid: false, activation: activationBlock(reason, { paidUrl, priceUsdc: "0.001" }) };
  };
  if (!hasKey) return takePreview("no PRIVATE_KEY configured");
  const res = await payFetch(paidUrl);
  if (res.ok || res.status === 200) {
    const out = await res.json();
    return { prices: Array.isArray(out) ? out : [], paid: true };
  }
  const reason = res.status === 402 ? "wallet not funded (paid /crypto/prices returned 402)" : `paid /crypto/prices returned HTTP ${res.status}`;
  return takePreview(reason);
}

// --------------------------------------------------------------------------
// Runners — one enriched object a tool can hand straight back to the model
// --------------------------------------------------------------------------

/** Run /defi/yields. Returns `{ yields, count, summary, paid, activation?, guard_reasons? }`. Never throws into the agent runtime — a true outage returns `{ error, yields:[] }`. */
export async function runYields(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  try {
    const out = await fetchYieldsOrPreview(payFetch, args, { hasKey, previewFetch });
    const result = {
      yields: out.yields,
      count: out.yields.length,
      summary: summarizeYields(out.yields),
      paid: out.paid,
    };
    if (out.total_available != null) result.total_available = out.total_available;
    if (out.activation) {
      result.activation = out.activation;
      result.guard_reasons = [out.activation.hint];
    }
    return result;
  } catch (err) {
    const msg = `defi/yields unavailable: ${err?.message || err}`;
    return { error: msg, yields: [], count: 0, summary: `ERROR: ${msg}`, paid: false };
  }
}

/** Run /crypto/prices. Returns `{ prices, summary, paid, activation? }`. Never throws into the agent runtime. */
export async function runPrices(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  try {
    const out = await fetchPricesOrPreview(payFetch, args, { hasKey, previewFetch });
    const result = { prices: out.prices, summary: summarizePrices(out.prices), paid: out.paid };
    if (out.activation) {
      result.activation = out.activation;
      result.guard_reasons = [out.activation.hint];
    }
    return result;
  } catch (err) {
    const msg = `crypto/prices unavailable: ${err?.message || err}`;
    return { error: msg, prices: [], summary: `ERROR: ${msg}`, paid: false };
  }
}

/**
 * Run /chain/balance. There is NO free preview for a live on-chain read, so a
 * keyless / unfunded install gets an activation stub (no data) rather than a
 * fabricated balance — honest degrade. Returns the balance object + `summary`
 * on the paid path; `{ activation, paid:false }` when no funded wallet.
 */
export async function runBalance(payFetch, args = {}, { hasKey = true } = {}) {
  const paidUrl = buildBalanceUrl(args);
  try {
    if (!hasKey) {
      return {
        address: args.address,
        paid: false,
        summary: "balance requires a funded wallet — running keyless",
        activation: activationBlock("no PRIVATE_KEY configured", { paidUrl, priceUsdc: "0.002" }),
        guard_reasons: [fundOnrampHint()],
      };
    }
    const res = await payFetch(paidUrl);
    if (res.ok || res.status === 200) {
      const out = await res.json();
      return { ...out, paid: true, summary: summarizeBalance(out) };
    }
    const reason = res.status === 402 ? "wallet not funded (paid /chain/balance returned 402)" : `paid /chain/balance returned HTTP ${res.status}`;
    return {
      address: args.address,
      paid: false,
      summary: `balance unavailable — ${reason}`,
      activation: activationBlock(reason, { paidUrl, priceUsdc: "0.002" }),
      guard_reasons: [fundOnrampHint()],
    };
  } catch (err) {
    const msg = `chain/balance unavailable: ${err?.message || err}`;
    return { error: msg, address: args.address, paid: false, summary: `ERROR: ${msg}` };
  }
}

// --------------------------------------------------------------------------
// Base-RPC read routes — gas-price, block-number, token-balance
// --------------------------------------------------------------------------
// These three expose a FREE preview that returns the SAME full live data as the
// paid route: gas-price and block-number are byte-identical; token-balance
// returns the real balance for the caller's own address+token. So a keyless
// install gets REAL on-chain data — never a 1-row sample and never a fabricated
// number; a funded wallet simply moves the read onto the metered paid route.

/** USDC on Base — the default token for a token-balance read when none is given (mirrors the server preview default). */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Build the paid /chain/gas-price URL. */
export function buildGasPriceUrl({ base = DATA_BASE } = {}) {
  return `${base}/chain/gas-price`;
}
/** Build the FREE /chain/gas-price/preview URL (full live data, identical to paid). */
export function buildGasPricePreviewUrl({ base = DATA_BASE } = {}) {
  return `${base}/chain/gas-price/preview`;
}

/** Build the paid /chain/block-number URL. */
export function buildBlockNumberUrl({ base = DATA_BASE } = {}) {
  return `${base}/chain/block-number`;
}
/** Build the FREE /chain/block-number/preview URL (full live data, identical to paid). */
export function buildBlockNumberPreviewUrl({ base = DATA_BASE } = {}) {
  return `${base}/chain/block-number/preview`;
}

/** Build the paid /chain/token-balance URL. Throws on a malformed address/token so a bad call never silently costs a payment. */
export function buildTokenBalanceUrl({ address, token = BASE_USDC, base = DATA_BASE } = {}) {
  if (!ADDR_RE.test(String(address || ""))) throw new Error(`invalid Base address: ${address}`);
  if (!ADDR_RE.test(String(token || ""))) throw new Error(`invalid Base token address: ${token}`);
  const qs = new URLSearchParams({ address, token });
  return `${base}/chain/token-balance?${qs.toString()}`;
}
/** Build the FREE /chain/token-balance/preview URL (returns the real balance for the given address+token). */
export function buildTokenBalancePreviewUrl({ address, token = BASE_USDC, base = DATA_BASE } = {}) {
  if (!ADDR_RE.test(String(address || ""))) throw new Error(`invalid Base address: ${address}`);
  if (!ADDR_RE.test(String(token || ""))) throw new Error(`invalid Base token address: ${token}`);
  const qs = new URLSearchParams({ address, token });
  return `${base}/chain/token-balance/preview?${qs.toString()}`;
}

function gwei(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return `${n < 0.001 && n > 0 ? n.toExponential(2) : n.toFixed(n < 1 ? 4 : 2)} gwei`;
}

/** One-line summary of a /chain/gas-price object. */
export function summarizeGasPrice(out) {
  if (!out || typeof out !== "object" || out.gas_price_gwei == null) return "no gas price";
  const bits = [];
  const g = gwei(Number(out.gas_price_gwei));
  if (g) bits.push(`gas ${g}`);
  const bf = gwei(typeof out.base_fee_gwei === "number" ? out.base_fee_gwei : NaN);
  if (bf) bits.push(`base ${bf}`);
  const pf = gwei(typeof out.priority_fee_gwei === "number" ? out.priority_fee_gwei : NaN);
  if (pf) bits.push(`priority ${pf}`);
  return `Base ${bits.join(" · ") || "gas price"}`;
}

/** One-line summary of a /chain/block-number object. */
export function summarizeBlockNumber(out) {
  if (!out || typeof out !== "object" || out.block_number == null) return "no block number";
  return `Base mainnet block #${Number(out.block_number).toLocaleString("en-US")}`;
}

/** One-line summary of a /chain/token-balance object. */
export function summarizeTokenBalance(out) {
  if (!out || typeof out !== "object" || out.balance == null) return "no token balance";
  const sym = out.symbol || "token";
  const addr = out.address ? `${String(out.address).slice(0, 10)}…` : "address";
  const bal = Number(out.balance);
  const amt = Number.isFinite(bal)
    ? bal.toLocaleString("en-US", { maximumFractionDigits: 6 })
    : out.balance_formatted;
  return `${addr} holds ${amt} ${sym} on Base`;
}

/**
 * Shared runner for the two "full-preview" Base-RPC reads (gas-price,
 * block-number) whose free preview is byte-identical to the paid route. Keyless
 * or 402 → the preview (real full data, `paid:false` + activation); funded →
 * the metered paid route. Never throws into the agent runtime.
 */
async function runFullPreviewRead(payFetch, { paidUrl, previewUrl, summarize, priceUsdc, label }, { hasKey, previewFetch }) {
  try {
    if (hasKey) {
      const res = await payFetch(paidUrl);
      if (res.ok || res.status === 200) {
        const out = await res.json();
        return { ...out, paid: true, summary: summarize(out) };
      }
      const reason = res.status === 402 ? `wallet not funded (paid ${label} returned 402)` : `paid ${label} returned HTTP ${res.status}`;
      const out = await plainGet(previewFetch, previewUrl);
      return { ...out, paid: false, summary: summarize(out), activation: activationBlock(reason, { paidUrl, priceUsdc }) };
    }
    const out = await plainGet(previewFetch, previewUrl);
    return {
      ...out,
      paid: false,
      summary: summarize(out),
      activation: activationBlock("no PRIVATE_KEY configured — free preview returns identical full data", { paidUrl, priceUsdc }),
    };
  } catch (err) {
    const msg = `${label} unavailable: ${err?.message || err}`;
    return { error: msg, paid: false, summary: `ERROR: ${msg}` };
  }
}

/** Run /chain/gas-price (Base EIP-1559 gas, base/priority fee, gas_price_usd). Keyless gets the real price via the identical free preview. Returns the gas object + `summary` (+ `paid`, + `activation` on the free path). */
export async function runGasPrice(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  return runFullPreviewRead(
    payFetch,
    { paidUrl: buildGasPriceUrl(args), previewUrl: buildGasPricePreviewUrl(args), summarize: summarizeGasPrice, priceUsdc: "0.002", label: "/chain/gas-price" },
    { hasKey, previewFetch },
  );
}

/** Run /chain/block-number (current Base mainnet block). Keyless gets the real block via the identical free preview. Returns `{ block_number, chain, summary, paid, activation? }`. */
export async function runBlockNumber(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  return runFullPreviewRead(
    payFetch,
    { paidUrl: buildBlockNumberUrl(args), previewUrl: buildBlockNumberPreviewUrl(args), summarize: summarizeBlockNumber, priceUsdc: "0.002", label: "/chain/block-number" },
    { hasKey, previewFetch },
  );
}

/**
 * Run /chain/token-balance (ERC-20 balance of a Base address). The free preview
 * returns the REAL balance for the caller's own address+token, so a keyless
 * install gets a real number (never a fabricated one). `token` defaults to USDC.
 * Never throws into the agent runtime.
 */
export async function runTokenBalance(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  const resolved = { ...args, token: args.token || BASE_USDC };
  let paidUrl;
  let previewUrl;
  try {
    paidUrl = buildTokenBalanceUrl(resolved);
    previewUrl = buildTokenBalancePreviewUrl(resolved);
  } catch (err) {
    const msg = `chain/token-balance unavailable: ${err?.message || err}`;
    return { error: msg, address: args.address, token: resolved.token, paid: false, summary: `ERROR: ${msg}` };
  }
  try {
    if (hasKey) {
      const res = await payFetch(paidUrl);
      if (res.ok || res.status === 200) {
        const out = await res.json();
        return { ...out, paid: true, summary: summarizeTokenBalance(out) };
      }
      const reason = res.status === 402 ? "wallet not funded (paid /chain/token-balance returned 402)" : `paid /chain/token-balance returned HTTP ${res.status}`;
      const out = await plainGet(previewFetch, previewUrl);
      return { ...out, paid: false, summary: summarizeTokenBalance(out), activation: activationBlock(reason, { paidUrl, priceUsdc: "0.002" }) };
    }
    const out = await plainGet(previewFetch, previewUrl);
    return {
      ...out,
      paid: false,
      summary: summarizeTokenBalance(out),
      activation: activationBlock("no PRIVATE_KEY configured — free preview returns the real balance", { paidUrl, priceUsdc: "0.002" }),
    };
  } catch (err) {
    const msg = `chain/token-balance unavailable: ${err?.message || err}`;
    return { error: msg, address: args.address, token: resolved.token, paid: false, summary: `ERROR: ${msg}` };
  }
}

// --------------------------------------------------------------------------
// Market-intelligence routes — perp funding, one-call market brief
// --------------------------------------------------------------------------
// Higher-value routes that lift $/payer above the $0.001 base tier and that
// external agents demonstrably bundle (the top repeat buyer pays several market
// routes per session). /crypto/funding ($0.004) exposes a free 1-row preview
// (a REAL top-coin sample) so a keyless install still returns live data;
// /brief/market ($0.01) has no preview, so keyless returns an activation stub
// — never a fabricated brief.

/** Build the paid /crypto/funding URL (top N coins by 24h notional volume). */
export function buildFundingUrl({ limit = 20, base = DATA_BASE } = {}) {
  const qs = new URLSearchParams({ limit: String(clampLimit(limit)) });
  return `${base}/crypto/funding?${qs.toString()}`;
}
/** Build the FREE /crypto/funding/preview URL (real top-1 sample). */
export function buildFundingPreviewUrl({ base = DATA_BASE } = {}) {
  return `${base}/crypto/funding/preview`;
}

/** Build the paid /brief/market URL (no params). */
export function buildMarketBriefUrl({ base = DATA_BASE } = {}) {
  return `${base}/brief/market`;
}

/** One-line summary of a /crypto/funding array (top coin + arb spread + signal + venues). */
export function summarizeFunding(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "no funding data";
  const t = rows[0];
  const bits = [t.coin || "coin"];
  if (typeof t.funding_spread_bps === "number") bits.push(`arb spread ${t.funding_spread_bps.toFixed(2)}bps`);
  if (t.signal) bits.push(String(t.signal));
  if (t.best_long_venue && t.best_short_venue) bits.push(`long@${t.best_long_venue}/short@${t.best_short_venue}`);
  return `Top of ${rows.length}: ${bits.join(" · ")}`;
}

/** One-line summary of a /brief/market object (sentiment + market cap + dominance + trending). */
export function summarizeMarketBrief(out) {
  if (!out || typeof out !== "object" || out.fear_greed == null) return "no market brief";
  const bits = [];
  if (out.fear_greed && out.fear_greed.value != null) {
    bits.push(`F&G ${out.fear_greed.value}${out.fear_greed.classification ? ` (${out.fear_greed.classification})` : ""}`);
  }
  const cap = out.global && usd(out.global.total_market_cap_usd);
  if (cap) bits.push(`mcap ${cap}`);
  if (out.global && typeof out.global.btc_dominance_pct === "number") bits.push(`BTC dom ${out.global.btc_dominance_pct.toFixed(1)}%`);
  const trend = Array.isArray(out.trending) && out.trending[0] ? (out.trending[0].symbol || out.trending[0].name) : null;
  if (trend) bits.push(`trending ${trend}`);
  return bits.join(" · ") || "market brief";
}

/**
 * Fetch /crypto/funding, DEGRADING OPEN to the free top-1 preview when the paid
 * call cannot be paid (no PRIVATE_KEY, or an unfunded wallet → 402). The sample
 * is a real top coin; only the depth (up to 100 ranked coins) is withheld.
 * Returns `{ funding, paid, total_available?, activation? }`.
 */
export async function fetchFundingOrPreview(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  const paidUrl = buildFundingUrl(args);
  const takePreview = async (reason) => {
    const out = await plainGet(previewFetch, buildFundingPreviewUrl(args));
    const funding = Array.isArray(out?.preview) ? out.preview : [];
    return { funding, paid: false, total_available: out?.total_available, activation: activationBlock(reason, { paidUrl, priceUsdc: "0.004" }) };
  };
  if (!hasKey) return takePreview("no PRIVATE_KEY configured");
  const res = await payFetch(paidUrl);
  if (res.ok || res.status === 200) {
    const out = await res.json();
    return { funding: Array.isArray(out) ? out : [], paid: true };
  }
  const reason = res.status === 402 ? "wallet not funded (paid /crypto/funding returned 402)" : `paid /crypto/funding returned HTTP ${res.status}`;
  return takePreview(reason);
}

/** Run /crypto/funding. Returns `{ funding, count, summary, paid, total_available?, activation? }`. Never throws into the agent runtime. */
export async function runFunding(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  try {
    const out = await fetchFundingOrPreview(payFetch, args, { hasKey, previewFetch });
    const result = {
      funding: out.funding,
      count: out.funding.length,
      summary: summarizeFunding(out.funding),
      paid: out.paid,
    };
    if (out.total_available != null) result.total_available = out.total_available;
    if (out.activation) {
      result.activation = out.activation;
      result.guard_reasons = [out.activation.hint];
    }
    return result;
  } catch (err) {
    const msg = `crypto/funding unavailable: ${err?.message || err}`;
    return { error: msg, funding: [], count: 0, summary: `ERROR: ${msg}`, paid: false };
  }
}

/**
 * Run /brief/market. There is NO free preview for this composite route, so a
 * keyless / unfunded install gets an activation stub (no data) rather than a
 * fabricated brief — honest degrade. Returns the brief object + `summary` on
 * the paid path; `{ activation, paid:false }` when no funded wallet.
 */
export async function runMarketBrief(payFetch, args = {}, { hasKey = true } = {}) {
  const paidUrl = buildMarketBriefUrl(args);
  try {
    if (!hasKey) {
      return {
        paid: false,
        summary: "market brief requires a funded wallet — running keyless",
        activation: activationBlock("no PRIVATE_KEY configured", { paidUrl, priceUsdc: "0.01" }),
        guard_reasons: [fundOnrampHint()],
      };
    }
    const res = await payFetch(paidUrl);
    if (res.ok || res.status === 200) {
      const out = await res.json();
      return { ...out, paid: true, summary: summarizeMarketBrief(out) };
    }
    const reason = res.status === 402 ? "wallet not funded (paid /brief/market returned 402)" : `paid /brief/market returned HTTP ${res.status}`;
    return {
      paid: false,
      summary: `market brief unavailable — ${reason}`,
      activation: activationBlock(reason, { paidUrl, priceUsdc: "0.01" }),
      guard_reasons: [fundOnrampHint()],
    };
  } catch (err) {
    const msg = `brief/market unavailable: ${err?.message || err}`;
    return { error: msg, paid: false, summary: `ERROR: ${msg}` };
  }
}

// --------------------------------------------------------------------------
// Token-safety route — pre-trade rug/honeypot verdict
// --------------------------------------------------------------------------
// /chain/token-report ($0.01) answers "is this Base ERC-20 safe to buy?" with a
// decision-grade verdict — SAFE | CAUTION | AVOID — plus a 0-100 risk_score and
// the reasons (honeypot/sellability simulation, buy/sell tax, owner-renounced +
// mint/pause/blacklist/fee-setter/upgradeable-proxy checks, owner supply %, and
// Uniswap-v3 WETH-pool liquidity in USD). The FREE preview returns the SAME full
// verdict for ANY Base token, but is capped at 3 real tokens/IP/day; the five
// demo tokens (WETH/USDC/cbBTC/AERO/DEGEN) are un-metered. So a keyless install
// returns a REAL verdict (never a stub) — on the default demo token when none is
// given, or on the caller's token until the daily trial is spent, after which it
// honestly reports the trial is exhausted and points at the paid route rather
// than fabricating a verdict. This lifts $/payer above the $0.001 data tier and
// matches GoPlus/honeypot.is/TokenSniffer — but keyless and key-free over x402.

/** Aerodrome on Base — an un-metered demo token, used as the default so a keyless token-safety probe always returns a real verdict. */
export const DEMO_TOKEN = "0x940181a94a35a4569e4529a3cdfb74e38fd98631";

/** Build the paid /chain/token-report URL. Throws on a malformed token so a bad call never silently costs a payment. */
export function buildTokenReportUrl({ token = DEMO_TOKEN, base = DATA_BASE } = {}) {
  if (!ADDR_RE.test(String(token || ""))) throw new Error(`invalid Base token address: ${token}`);
  const qs = new URLSearchParams({ token });
  return `${base}/chain/token-report?${qs.toString()}`;
}
/** Build the FREE /chain/token-report/preview URL (same full verdict, capped 3 real tokens/IP/day). */
export function buildTokenReportPreviewUrl({ token = DEMO_TOKEN, base = DATA_BASE } = {}) {
  if (!ADDR_RE.test(String(token || ""))) throw new Error(`invalid Base token address: ${token}`);
  const qs = new URLSearchParams({ token });
  return `${base}/chain/token-report/preview?${qs.toString()}`;
}

/** One-line summary of a /chain/token-report object (verdict + risk score + symbol + top reasons). */
export function summarizeTokenReport(out) {
  if (!out || typeof out !== "object") return "no token report";
  if (out.trial_exhausted) return "token-safety free trial exhausted for today (3/day/IP) — pay $0.01 for any token";
  if (out.verdict == null) return out.note ? `token report unavailable — ${out.note}` : "no token report";
  const sym = (out.token_meta && out.token_meta.symbol) || out.symbol || "token";
  const bits = [`${sym}: ${out.verdict}`];
  if (typeof out.risk_score === "number") bits.push(`risk ${out.risk_score}/100`);
  const reasons = Array.isArray(out.reasons) ? out.reasons.slice(0, 3) : [];
  if (reasons.length) bits.push(reasons.join("; "));
  return bits.join(" · ");
}

/** Shape the preview/paid body into a compact, model-ready verdict object (keeps the structured fields the agent needs to gate a trade). */
function shapeTokenReport(out, { paid }) {
  const symbol = (out && out.token_meta && out.token_meta.symbol) || undefined;
  const result = {
    token: out && out.token,
    verdict: (out && out.verdict) ?? null,
    risk_score: out && typeof out.risk_score === "number" ? out.risk_score : null,
    symbol,
    reasons: Array.isArray(out && out.reasons) ? out.reasons.slice(0, 5) : [],
    security: out && out.security,
    liquidity: out && out.liquidity,
    paid,
  };
  result.summary = summarizeTokenReport({ ...out, ...result });
  return result;
}

/**
 * Run /chain/token-report — the pre-trade safety verdict. `token` defaults to an
 * un-metered demo token so a keyless probe always returns a REAL verdict. A
 * keyless/unfunded install reads the free preview (same full verdict, capped at
 * 3 real tokens/IP/day); when that daily trial is spent the preview returns 429
 * and this degrades OPEN to an honest `{verdict:null, trial_exhausted:true}` that
 * points at the paid route — never a fabricated verdict and never a throw into
 * the agent runtime.
 */
export async function runTokenReport(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  const resolved = { ...args, token: args.token || DEMO_TOKEN };
  let paidUrl;
  let previewUrl;
  try {
    paidUrl = buildTokenReportUrl(resolved);
    previewUrl = buildTokenReportPreviewUrl(resolved);
  } catch (err) {
    const msg = `chain/token-report unavailable: ${err?.message || err}`;
    return { error: msg, token: args.token, verdict: null, risk_score: null, reasons: [], paid: false, summary: `ERROR: ${msg}` };
  }
  const takePreview = async (reason) => {
    const f = previewFetch || (typeof fetch !== "undefined" ? fetch : null);
    if (!f) throw new Error("no fetch available");
    const res = await f(previewUrl);
    const body = await res.json();
    if (res.status === 429 || body?.trial?.real_token_checks_left_today === 0) {
      // Trial spent — honest degrade-open: no verdict, point at the paid route.
      return {
        token: resolved.token,
        verdict: null,
        risk_score: null,
        reasons: [],
        trial_exhausted: true,
        note: body?.error || "free real-token trial exhausted (3/day/IP)",
        paid_url: body?.paid_url || paidUrl,
        paid: false,
        summary: summarizeTokenReport({ trial_exhausted: true }),
        activation: activationBlock(reason, { paidUrl, priceUsdc: "0.01" }),
        guard_reasons: [fundOnrampHint()],
      };
    }
    if (!res.ok && res.status !== 200) throw new Error(`preview failed: HTTP ${res.status}`);
    const shaped = shapeTokenReport(body, { paid: false });
    shaped.activation = activationBlock(reason, { paidUrl, priceUsdc: "0.01" });
    shaped.guard_reasons = [fundOnrampHint()];
    return shaped;
  };
  try {
    if (hasKey) {
      const res = await payFetch(paidUrl);
      if (res.ok || res.status === 200) {
        const out = await res.json();
        return shapeTokenReport(out, { paid: true });
      }
      const reason = res.status === 402 ? "wallet not funded (paid /chain/token-report returned 402)" : `paid /chain/token-report returned HTTP ${res.status}`;
      return await takePreview(reason);
    }
    return await takePreview("no PRIVATE_KEY configured — free preview returns the full verdict (capped 3 real tokens/IP/day)");
  } catch (err) {
    const msg = `chain/token-report unavailable: ${err?.message || err}`;
    return { error: msg, token: resolved.token, verdict: null, risk_score: null, reasons: [], paid: false, summary: `ERROR: ${msg}` };
  }
}

// --------------------------------------------------------------------------
// /defi/yield-entry-verdict ($0.01) — the per-pool go/no-go that rides the
// #1-demand /defi/yields lane. runYields finds WHERE the APY is; this answers
// "should I actually enter THIS pool?" with SUSTAINABLE | DECAYING | OUTLIER |
// AVOID + a 0-100 risk score + field-cited reasons (APY 1d/7d/30d trend,
// DefiLlama stability forecast, IL, volatility sigma, outlier flag, TVL). The
// natural upsell for any agent that already called runYields. The free preview
// returns a SAMPLE verdict (the current top-TVL pool) — the verdict for the
// caller's specific poolId is the paid route, so keyless degrades OPEN to the
// sample + an honest "this is a sample, not your pool" note (never a fabricated
// verdict for a pool we did not price). Matches the due-diligence layer a yield
// agent would otherwise hand-roll off raw DefiLlama fields.

/** Build the paid /defi/yield-entry-verdict URL. `pool` is the DefiLlama poolId from /defi/yields; optional `token` (0x, Base) adds a honeypot-check pointer. */
export function buildYieldEntryVerdictUrl({ pool, token, base = DATA_BASE } = {}) {
  const p = String(pool || "").trim();
  if (!p) throw new Error("pool required — the 'pool' field (DefiLlama poolId) from /defi/yields");
  const qs = new URLSearchParams({ pool: p });
  if (token && ADDR_RE.test(String(token))) qs.set("token", String(token));
  return `${base}/defi/yield-entry-verdict?${qs.toString()}`;
}
/** Build the FREE /defi/yield-entry-verdict/preview URL (sample verdict for the current top-TVL pool; the pool arg is ignored upstream). */
export function buildYieldEntryVerdictPreviewUrl({ base = DATA_BASE } = {}) {
  return `${base}/defi/yield-entry-verdict/preview`;
}

/** One-line summary of a yield-entry verdict (verdict + risk + APY + top reason). */
export function summarizeYieldEntryVerdict(out) {
  if (!out || typeof out !== "object") return "no yield-entry verdict";
  if (out.verdict == null) return out.note ? `yield-entry verdict unavailable — ${out.note}` : "no yield-entry verdict";
  const label = out.symbol || out.project || "pool";
  const bits = [`${label}: ${out.verdict}`];
  if (typeof out.risk_score === "number") bits.push(`risk ${out.risk_score}/100`);
  if (typeof out.apy === "number") bits.push(`APY ${out.apy.toFixed(2)}%`);
  const reasons = Array.isArray(out.reasons)
    ? out.reasons
        .slice(0, 2)
        .map((r) => (typeof r === "string" ? r : r && (r.detail || r.code)))
        .filter(Boolean)
    : [];
  if (reasons.length) bits.push(reasons.join("; "));
  if (out.is_sample) bits.push("(SAMPLE — pay for your pool)");
  return bits.join(" · ");
}

/** Shape a yield-entry verdict body into a compact, model-ready object. */
function shapeYieldEntryVerdict(out, { paid, isSample }) {
  const v = out && typeof out === "object" ? out : {};
  const result = {
    pool: v.pool,
    project: v.project,
    chain: v.chain,
    symbol: v.symbol,
    verdict: v.verdict ?? null,
    risk_score: typeof v.risk_score === "number" ? v.risk_score : null,
    reasons: Array.isArray(v.reasons) ? v.reasons.slice(0, 5) : [],
    apy: typeof v.apy === "number" ? v.apy : null,
    apyPct7D: v.apyPct7D ?? null,
    apyPct30D: v.apyPct30D ?? null,
    predicted: v.predicted ?? null,
    tvlUsd: v.tvlUsd ?? null,
    token_safety_hint: v.token_safety_hint,
    is_sample: !!isSample,
    paid,
  };
  result.summary = summarizeYieldEntryVerdict(result);
  return result;
}

/**
 * Run /defi/yield-entry-verdict — the per-pool go/no-go. `pool` is required (the
 * DefiLlama poolId from runYields). A keyless/unfunded install reads the free
 * preview, which returns the current TOP-TVL pool's verdict as a SAMPLE (not the
 * caller's pool); this degrades OPEN with `is_sample:true` + an honest note and
 * the paid pointer rather than fabricating a verdict for an un-priced pool.
 */
export async function runYieldEntryVerdict(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  const pool = String(args.pool || "").trim();
  if (!pool) {
    const msg = "pool required — pass the 'pool' field (DefiLlama poolId) returned by runYields / GET /defi/yields.";
    return { error: msg, pool: undefined, verdict: null, risk_score: null, reasons: [], apy: null, is_sample: false, paid: false, summary: `ERROR: ${msg}` };
  }
  let paidUrl;
  try {
    paidUrl = buildYieldEntryVerdictUrl({ ...args, pool });
  } catch (err) {
    const msg = `defi/yield-entry-verdict unavailable: ${err?.message || err}`;
    return { error: msg, pool, verdict: null, risk_score: null, reasons: [], apy: null, is_sample: false, paid: false, summary: `ERROR: ${msg}` };
  }
  const previewUrl = buildYieldEntryVerdictPreviewUrl(args);
  const takePreview = async (reason) => {
    const out = await plainGet(previewFetch, previewUrl);
    const sample = (out && out.preview) || {};
    const shaped = shapeYieldEntryVerdict(sample, { paid: false, isSample: true });
    shaped.note = `Free preview is the current top-TVL pool verdict — a SAMPLE, not pool ${pool}. The go/no-go for YOUR pool is the paid route ($0.01).`;
    shaped.activation = activationBlock(reason, { paidUrl, priceUsdc: "0.01" });
    shaped.guard_reasons = [fundOnrampHint()];
    return shaped;
  };
  try {
    if (hasKey) {
      const res = await payFetch(paidUrl);
      if (res.ok || res.status === 200) {
        const out = await res.json();
        return shapeYieldEntryVerdict(out, { paid: true, isSample: false });
      }
      const reason = res.status === 402 ? "wallet not funded (paid /defi/yield-entry-verdict returned 402)" : `paid /defi/yield-entry-verdict returned HTTP ${res.status}`;
      return await takePreview(reason);
    }
    return await takePreview("no PRIVATE_KEY configured — free preview returns a SAMPLE verdict (top-TVL pool); the per-pool verdict is paid ($0.01)");
  } catch (err) {
    const msg = `defi/yield-entry-verdict unavailable: ${err?.message || err}`;
    return { error: msg, pool, verdict: null, risk_score: null, reasons: [], apy: null, is_sample: false, paid: false, summary: `ERROR: ${msg}` };
  }
}

// --------------------------------------------------------------------------
// /chain/simulate ($0.005) — prospective-transaction dry-run via eth_simulateV1.
// Answers "will THIS Base tx revert, how much gas, what tokens move" BEFORE the
// agent spends gas sending it. The pre-trade check for any swap/approve/transfer
// and the natural companion to checkToken (/chain/token-report). The free
// preview is a benign demo dry-run (synthetic addresses) that shows the output
// shape; the dry-run of the caller's actual tx is the paid route, so keyless
// degrades OPEN to the demo sample + an honest "this is a demo, not your tx"
// note rather than fabricating a verdict for a tx we did not simulate.

/** Build the paid /chain/simulate URL. `from`+`to` are required 0x Base addresses; optional `data` (0x calldata) + `value` (wei, decimal or 0x). Throws on a malformed address so a bad call never silently costs a payment. */
export function buildSimulateUrl({ from, to, data, value, base = DATA_BASE } = {}) {
  const f = String(from || "").trim();
  const t = String(to || "").trim();
  if (!ADDR_RE.test(f) || !ADDR_RE.test(t)) throw new Error("from and to are required 0x Base addresses");
  const qs = new URLSearchParams({ from: f, to: t });
  const d = data ? String(data).trim() : "";
  if (d) qs.set("data", d);
  const v = value !== undefined && value !== null && String(value).trim() !== "" ? String(value).trim() : "";
  if (v) qs.set("value", v);
  return `${base}/chain/simulate?${qs.toString()}`;
}
/** Build the FREE /chain/simulate/preview URL (benign demo dry-run; caller args are ignored upstream). */
export function buildSimulatePreviewUrl({ base = DATA_BASE } = {}) {
  return `${base}/chain/simulate/preview`;
}

/** One-line summary of a simulation (revert verdict + gas + token-move count). */
export function summarizeSimulation(out) {
  if (!out || typeof out !== "object") return "no simulation";
  if (out.will_revert == null) return out.note ? `simulation unavailable — ${out.note}` : "simulation unavailable";
  const bits = [out.will_revert ? "WILL REVERT" : "will NOT revert"];
  if (out.will_revert && out.revert_reason) bits.push(String(out.revert_reason));
  if (out.gas_used != null) bits.push(`gas ${out.gas_used}`);
  const moves = Array.isArray(out.asset_changes) ? out.asset_changes.length : 0;
  if (moves) bits.push(`${moves} token move${moves === 1 ? "" : "s"}`);
  if (out.is_sample) bits.push("(DEMO — pay for your tx)");
  return bits.join(" · ");
}

/** Shape a /chain/simulate body into a compact, model-ready object. */
function shapeSimulation(out, { paid, isSample }) {
  const v = out && typeof out === "object" ? out : {};
  const result = {
    from: v.from,
    to: v.to,
    value: v.value,
    will_revert: typeof v.will_revert === "boolean" ? v.will_revert : v.will_revert ?? null,
    revert_reason: v.revert_reason ?? null,
    gas_used: v.gas_used ?? null,
    asset_changes: Array.isArray(v.asset_changes) ? v.asset_changes : [],
    raw_status: v.raw_status ?? null,
    is_sample: !!isSample,
    paid,
  };
  result.summary = summarizeSimulation(result);
  return result;
}

/**
 * Run /chain/simulate — prospective-tx dry-run. `from`+`to` are required 0x Base
 * addresses; optional `data` (0x calldata) and `value` (wei). A keyless/unfunded
 * install reads the free preview, which is a benign DEMO dry-run (synthetic
 * addresses, not the caller's tx); this degrades OPEN with `is_sample:true` + an
 * honest note and the paid pointer rather than fabricating a verdict for a tx we
 * did not simulate. Never throws into the agent runtime.
 */
export async function runSimulate(payFetch, args = {}, { hasKey = true, previewFetch } = {}) {
  const from = String(args.from || "").trim();
  const to = String(args.to || "").trim();
  if (!ADDR_RE.test(from) || !ADDR_RE.test(to)) {
    const msg = "from and to are required 0x Base addresses — pass the prospective tx's sender and target.";
    return { error: msg, from: args.from, to: args.to, will_revert: null, gas_used: null, asset_changes: [], is_sample: false, paid: false, summary: `ERROR: ${msg}` };
  }
  let paidUrl;
  try {
    paidUrl = buildSimulateUrl({ ...args, from, to });
  } catch (err) {
    const msg = `chain/simulate unavailable: ${err?.message || err}`;
    return { error: msg, from, to, will_revert: null, gas_used: null, asset_changes: [], is_sample: false, paid: false, summary: `ERROR: ${msg}` };
  }
  const previewUrl = buildSimulatePreviewUrl(args);
  const takePreview = async (reason) => {
    const out = await plainGet(previewFetch, previewUrl);
    const sample = (out && out.preview) || {};
    const shaped = shapeSimulation(sample, { paid: false, isSample: true });
    shaped.note = "Free preview is a benign demo dry-run (synthetic addresses) — not your tx. The dry-run of YOUR tx is the paid route ($0.005).";
    shaped.activation = activationBlock(reason, { paidUrl, priceUsdc: "0.005" });
    shaped.guard_reasons = [fundOnrampHint()];
    return shaped;
  };
  try {
    if (hasKey) {
      const res = await payFetch(paidUrl);
      if (res.ok || res.status === 200) {
        const out = await res.json();
        return shapeSimulation(out, { paid: true, isSample: false });
      }
      const reason = res.status === 402 ? "wallet not funded (paid /chain/simulate returned 402)" : `paid /chain/simulate returned HTTP ${res.status}`;
      return await takePreview(reason);
    }
    return await takePreview("no PRIVATE_KEY configured — free preview returns a demo dry-run; YOUR tx dry-run is paid ($0.005)");
  } catch (err) {
    const msg = `chain/simulate unavailable: ${err?.message || err}`;
    return { error: msg, from, to, will_revert: null, gas_used: null, asset_changes: [], is_sample: false, paid: false, summary: `ERROR: ${msg}` };
  }
}
