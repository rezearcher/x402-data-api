import type { Plugin } from "@elizaos/core";
import { getDefiYields } from "./actions/getDefiYields.js";
import { getYieldEntryVerdict } from "./actions/getYieldEntryVerdict.js";
import { getCryptoPrices } from "./actions/getCryptoPrices.js";
import { getFundingRates } from "./actions/getFundingRates.js";
import { checkToken } from "./actions/checkToken.js";

/**
 * Grey Ridge DeFi/market-data plugin for ElizaOS trading agents.
 *
 * Five actions, each paid inline per call via x402 USDC on Base — no API key, no
 * account, no subscription. Unlike raw-data rivals, every action leads with a
 * DECISION layer on a 99%-uptime, correctness-canaried route:
 *   - GET_DEFI_YIELDS      → /defi/yields              ($0.001) ranked pools + risk-adjusted score + APY trend
 *   - YIELD_ENTRY_VERDICT  → /defi/yield-entry-verdict ($0.01)  per-pool SUSTAINABLE/DECAYING/OUTLIER/AVOID go/no-go
 *   - GET_CRYPTO_PRICES    → /crypto/prices            ($0.001) spot price + 24h change (<=25 tokens)
 *   - GET_FUNDING_RATES    → /crypto/funding           ($0.004) cross-venue funding + OI-weighted arb verdict
 *   - CHECK_TOKEN          → /chain/token-report       ($0.01)  pre-trade SAFE/CAUTION/AVOID verdict
 *
 * Every action degrades OPEN to the free preview when no funded wallet is set,
 * so a keyless install still returns real data plus an activation hint.
 */
export const defiDataPlugin: Plugin = {
  name: "plugin-defi-data",
  description:
    "DeFi/market data for Base trading agents with a decision layer: GET_DEFI_YIELDS (ranked yields + risk score), YIELD_ENTRY_VERDICT (per-pool SUSTAINABLE/DECAYING/OUTLIER/AVOID), GET_CRYPTO_PRICES, GET_FUNDING_RATES (OI-weighted arb verdict) and CHECK_TOKEN (SAFE/CAUTION/AVOID) — paid inline with x402 USDC from $0.001/call, no API key.",
  actions: [getDefiYields, getYieldEntryVerdict, getCryptoPrices, getFundingRates, checkToken],
  init: async (_config, _runtime) => {
    // Nothing to warm up; each action lazily builds its x402 fetch on first use.
  },
};

export {
  getDefiYields,
  getYieldEntryVerdict,
  getCryptoPrices,
  getFundingRates,
  checkToken,
};
export default defiDataPlugin;
