/**
 * Grey Ridge DeFi/market-data tools for LangChain.js trading agents.
 *
 * Drop-in LangChain tools that wrap Grey Ridge's live x402 data routes — paid
 * inline per call in USDC on Base, no API key, no account, no subscription:
 *   - `defiYields`    → /defi/yields    ($0.001) top lending/LP APY + IL risk + TVL
 *   - `cryptoPrices`  → /crypto/prices  ($0.001) spot price + 24h change (<=25 tokens)
 *   - `baseBalance`   → /chain/balance  ($0.002) ETH balance + balance_usd
 *
 * Each tool uses `responseFormat: "content_and_artifact"` (readable string for
 * the model + structured object on `.artifact`) and degrades OPEN to the free
 * preview when no funded wallet is set, so a keyless install still returns real
 * (sampled) data plus an activation hint.
 */
export {
  createDefiYields,
  createCryptoPrices,
  createBaseBalance,
  defiYields,
  cryptoPrices,
  baseBalance,
  defiDataTools,
} from "./tool.js";
export type { DataToolOptions } from "./tool.js";

// Dependency-free core, re-exported for agents that want the raw primitives.
export {
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
  fetchYieldsOrPreview,
  fetchPricesOrPreview,
  runYields,
  runPrices,
  runBalance,
} from "./data.mjs";
export type {
  YieldArgs,
  PricesArgs,
  BalanceArgs,
  YieldPool,
  TokenPrice,
  BalanceResponse,
  YieldsResult,
  PricesResult,
  BalanceResult,
  Activation,
} from "./data.mjs";

export { defiDataTools as default } from "./tool.js";
