/**
 * Grey Ridge DeFi/market-data tools for Vercel AI SDK trading agents.
 *
 * Drop-in AI SDK tools that wrap Grey Ridge's live x402 data routes — paid
 * inline per call in USDC on Base, no API key, no account, no subscription:
 *   - `defiYields`       → /defi/yields       ($0.001) top lending/LP APY + IL risk + TVL
 *   - `cryptoPrices`     → /crypto/prices     ($0.001) spot price + 24h change (<=25 tokens)
 *   - `baseBalance`      → /chain/balance     ($0.002) ETH balance + balance_usd
 *   - `baseGasPrice`     → /chain/gas-price   ($0.002) EIP-1559 gas, gas_price_usd
 *   - `baseBlockNumber`  → /chain/block-number($0.002) current Base block height
 *   - `baseTokenBalance` → /chain/token-balance($0.002) ERC-20 balance (symbol/decimals)
 *
 * Each tool degrades OPEN to the free preview when no funded wallet is set, so
 * a keyless install still returns real data plus an activation hint. The three
 * Base-RPC reads (gas-price, block-number, token-balance) use a free preview
 * that is identical to the paid route, so keyless returns the real live value.
 */
export {
  createDefiYields,
  createCryptoPrices,
  createBaseBalance,
  createBaseGasPrice,
  createBaseBlockNumber,
  createBaseTokenBalance,
  defiYields,
  cryptoPrices,
  baseBalance,
  baseGasPrice,
  baseBlockNumber,
  baseTokenBalance,
  defiDataTools,
} from "./tool.js";
export type { DataToolOptions } from "./tool.js";

// Dependency-free core, re-exported for agents that want the raw primitives.
export {
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
  fetchYieldsOrPreview,
  fetchPricesOrPreview,
  runYields,
  runPrices,
  runBalance,
  runGasPrice,
  runBlockNumber,
  runTokenBalance,
} from "./data.mjs";
export type {
  YieldArgs,
  PricesArgs,
  BalanceArgs,
  ReadArgs,
  TokenBalanceArgs,
  YieldPool,
  TokenPrice,
  BalanceResponse,
  GasPriceResponse,
  BlockNumberResponse,
  TokenBalanceResponse,
  YieldsResult,
  PricesResult,
  BalanceResult,
  GasPriceResult,
  BlockNumberResult,
  TokenBalanceResult,
  Activation,
} from "./data.mjs";

export { defiDataTools as default } from "./tool.js";
