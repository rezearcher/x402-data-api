/**
 * Grey Ridge DeFi/market-data tools for LangChain.js trading agents.
 *
 * Drop-in LangChain tools that wrap Grey Ridge's live x402 data routes — paid
 * inline per call in USDC on Base, no API key, no account, no subscription:
 *   - `defiYields`       → /defi/yields       ($0.001) top lending/LP APY + IL risk + TVL
 *   - `cryptoPrices`     → /crypto/prices     ($0.001) spot price + 24h change (<=25 tokens)
 *   - `baseBalance`      → /chain/balance     ($0.002) ETH balance + balance_usd
 *   - `baseGasPrice`     → /chain/gas-price   ($0.002) EIP-1559 gas, gas_price_usd
 *   - `baseBlockNumber`  → /chain/block-number($0.002) current Base block height
 *   - `baseTokenBalance` → /chain/token-balance($0.002) ERC-20 balance (symbol/decimals)
 *   - `cryptoFunding`    → /crypto/funding    ($0.004) cross-venue perp funding + arb spread
 *   - `marketBrief`      → /brief/market      ($0.01)  one-call market snapshot
 *
 * Each tool uses `responseFormat: "content_and_artifact"` (readable string for
 * the model + structured object on `.artifact`) and degrades OPEN to the free
 * preview when no funded wallet is set, so a keyless install still returns real
 * data plus an activation hint. The three Base-RPC reads (gas-price,
 * block-number, token-balance) use a free preview identical to the paid route,
 * so keyless returns the real live value.
 */
export {
  createDefiYields,
  createCryptoPrices,
  createBaseBalance,
  createBaseGasPrice,
  createBaseBlockNumber,
  createBaseTokenBalance,
  createCryptoFunding,
  createMarketBrief,
  defiYields,
  cryptoPrices,
  baseBalance,
  baseGasPrice,
  baseBlockNumber,
  baseTokenBalance,
  cryptoFunding,
  marketBrief,
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
  buildFundingUrl,
  buildFundingPreviewUrl,
  buildMarketBriefUrl,
  summarizeYields,
  summarizePrices,
  summarizeBalance,
  summarizeGasPrice,
  summarizeBlockNumber,
  summarizeTokenBalance,
  summarizeFunding,
  summarizeMarketBrief,
  fundOnrampHint,
  fetchYieldsOrPreview,
  fetchPricesOrPreview,
  fetchFundingOrPreview,
  runYields,
  runPrices,
  runBalance,
  runGasPrice,
  runBlockNumber,
  runTokenBalance,
  runFunding,
  runMarketBrief,
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
  FundingArgs,
  BriefArgs,
  FundingRow,
  MarketBriefResponse,
  FundingResult,
  MarketBriefResult,
  Activation,
} from "./data.mjs";

export { defiDataTools as default } from "./tool.js";
