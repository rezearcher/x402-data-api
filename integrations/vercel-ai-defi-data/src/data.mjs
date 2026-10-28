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

// --------------------------------------------------------------------------
// Input normalisers
// --------------------------------------------------------------------------

/** Normalise `coins` (string "a,b" or string[]) to a validated, de-duped id list. Throws on a bad id so a bad call never silently costs a payment. */
export function normalizeCoins(coins) {
  const raw = Array.isArray(coins)
    ? coins
    : String(coins || "")
        .split(",")
        .map((s) => s.trim());
  const ids = raw.filter(Boolean);
  if (ids.length === 0) throw new Error("coins must contain at least one CoinGecko id");
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
