// Dependency-free text parsing for the ElizaOS action handlers. Kept in a .mjs
// module so it is unit-tested without the agent runtime.

const ADDR_RE = /0x[a-fA-F0-9]{40}/;

/** First 0x…40-hex Base address found in free text, or undefined. */
export function extractAddress(text) {
  const m = String(text || "").match(ADDR_RE);
  return m ? m[0] : undefined;
}

// Common ways an agent refers to a coin in a sentence → CoinGecko id or ticker
// the /crypto/prices route accepts (it normalizes tickers itself).
const COIN_WORDS = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ether: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana",
  usdc: "usd-coin",
  usdt: "tether",
  xrp: "ripple",
  doge: "dogecoin",
  bnb: "binancecoin",
  ada: "cardano",
  avax: "avalanche-2",
  matic: "matic-network",
  link: "chainlink",
  arb: "arbitrum",
  op: "optimism",
};

/**
 * Best-effort list of coin ids mentioned in free text, de-duped and capped at
 * 25 (the route limit). Returns undefined when nothing recognizable is found so
 * the caller can fall back to an explicit `coins` setting/option.
 */
export function extractCoins(text) {
  const words = String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
  const ids = [];
  for (const w of words) {
    const id = COIN_WORDS[w];
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= 25) break;
  }
  return ids.length ? ids.join(",") : undefined;
}
