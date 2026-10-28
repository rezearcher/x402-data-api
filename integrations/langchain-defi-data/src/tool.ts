import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { makePayFetch, type PayFetch } from "./client.js";
// Core fetch/shaping logic lives in a dependency-free module so it is unit-
// tested without the LangChain runtime. Imported with the .mjs extension on purpose.
import {
  runYields,
  runPrices,
  runBalance,
  runGasPrice,
  runBlockNumber,
  runTokenBalance,
  runFunding,
  runMarketBrief,
  runTokenReport,
  BASE_USDC,
  DATA_BASE,
  type YieldsResult,
  type PricesResult,
  type BalanceResult,
  type GasPriceResult,
  type BlockNumberResult,
  type TokenBalanceResult,
  type FundingResult,
  type MarketBriefResult,
  type TokenReportResult,
} from "./data.mjs";

function envKey(): string | undefined {
  return typeof process !== "undefined" ? process.env?.PRIVATE_KEY : undefined;
}
function envBase(): string | undefined {
  return typeof process !== "undefined" ? process.env?.X402_DATA_BASE_URL : undefined;
}

export interface DataToolOptions {
  /** Pre-built x402-paying fetch; overrides `privateKey`. Mainly for tests. */
  payFetch?: PayFetch;
  /** Hex private key of the agent's Base wallet; signs the per-call USDC x402 payment. Omit for the free preview path only. */
  privateKey?: string;
  /** Override the data base URL (defaults to the hosted Grey Ridge Worker). */
  base?: string;
}

function resolve(opts: DataToolOptions) {
  const base = opts.base || DATA_BASE;
  const payFetch: PayFetch = opts.payFetch || makePayFetch(opts.privateKey);
  const hasKey = typeof opts.privateKey === "string" && opts.privateKey.length > 0;
  return { base, payFetch, hasKey };
}

/**
 * LangChain tool: top DeFi lending/LP yields from DefiLlama via Grey Ridge
 * `/defi/yields` ($0.001 USDC/call, paid inline with x402 — no API key). Returns
 * ranked pools with APY trend, IL risk, TVL and a risk-adjusted score, plus a
 * one-line `summary`. Degrades OPEN to a free top-1 sample when no funded wallet
 * is configured (carries an `activation` hint), so a keyless install still works.
 *
 * Uses `responseFormat: "content_and_artifact"` so the agent gets a readable
 * string AND the structured result object (`.artifact`) in one call.
 *
 * ```ts
 * import { createDefiYields } from "@grey-ridge/langchain-defi-data";
 * import { createReactAgent } from "@langchain/langgraph/prebuilt";
 * const defiYields = createDefiYields({ privateKey: process.env.PRIVATE_KEY });
 * const agent = createReactAgent({ llm, tools: [defiYields] });
 * await agent.invoke({ messages: [{ role: "user", content: "Best stablecoin yield on Base right now?" }] });
 * ```
 */
export function createDefiYields(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async ({
      limit,
      project,
      chain,
      stable,
      sort,
    }: {
      limit?: number;
      project?: string;
      chain?: string;
      stable?: boolean;
      sort?: "tvl" | "risk_adjusted";
    }): Promise<[string, YieldsResult]> => {
      const out = await runYields(payFetch, { limit, project, chain, stable, sort, base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "defi_yields",
      description:
        "Top DeFi lending/LP yields (DefiLlama) via Grey Ridge /defi/yields ($0.001 USDC/call, paid inline with x402 — no API key). Returns ranked pools with project, chain, symbol, APY + 1d/7d/30d trend, IL risk, TVL and a risk-adjusted score. Use to find where to earn yield. Filter by project/chain/stablecoin; sort by TVL or risk-adjusted APY.",
      schema: z.object({
        limit: z.number().positive().default(20).describe("Max pools to return (1-100)."),
        project: z.string().optional().describe("Protocol filter, e.g. 'aave-v3'."),
        chain: z.string().optional().describe("Chain filter, e.g. 'Base' or 'Ethereum'."),
        stable: z.boolean().optional().describe("Stablecoin-only pools when true."),
        sort: z
          .enum(["tvl", "risk_adjusted"])
          .default("tvl")
          .describe("Rank by TVL (default) or risk-adjusted APY (apy/sigma)."),
      }),
      responseFormat: "content_and_artifact",
    }
  );
}

/**
 * LangChain tool: spot token prices from DefiLlama via Grey Ridge
 * `/crypto/prices` ($0.001 USDC/call, paid inline with x402 — no API key).
 * Pass comma-separated CoinGecko ids (up to 25); returns price, 24h change,
 * symbol, confidence and timestamp per token, plus a one-line `summary`.
 * Degrades OPEN to a free 1-token sample when no funded wallet is configured.
 */
export function createCryptoPrices(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async ({ coins }: { coins: string }): Promise<[string, PricesResult]> => {
      const out = await runPrices(payFetch, { coins, base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "crypto_prices",
      description:
        "Spot token prices (DefiLlama) via Grey Ridge /crypto/prices ($0.001 USDC/call, paid inline with x402 — no API key). Pass comma-separated CoinGecko ids (up to 25); returns price, change_24h, symbol, confidence and timestamp per token.",
      schema: z.object({
        coins: z
          .string()
          .describe("Comma-separated CoinGecko ids (max 25), e.g. 'bitcoin,ethereum,solana'."),
      }),
      responseFormat: "content_and_artifact",
    }
  );
}

/**
 * LangChain tool: ETH balance of a Base address (incl. balance_usd) via Grey
 * Ridge `/chain/balance` ($0.002 USDC/call, paid inline with x402 — no API key).
 * There is no free preview for a live on-chain read, so a keyless install
 * returns an activation hint (no fabricated balance) rather than silently failing.
 */
export function createBaseBalance(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async ({ address }: { address: string }): Promise<[string, BalanceResult]> => {
      const out = await runBalance(payFetch, { address, base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "base_balance",
      description:
        "ETH balance of a Base mainnet address, including balance_usd, via Grey Ridge /chain/balance ($0.002 USDC/call, paid inline with x402 — no API key). Use to read a wallet's native balance on Base.",
      schema: z.object({
        address: z.string().describe("0x-prefixed Base mainnet address (40 hex chars)."),
      }),
      responseFormat: "content_and_artifact",
    }
  );
}

/**
 * LangChain tool: current Base mainnet gas price via Grey Ridge
 * `/chain/gas-price` ($0.002 USDC/call, paid inline with x402 — no API key).
 * Returns EIP-1559 base_fee_gwei / priority_fee_gwei, gas_price_gwei/_wei and
 * gas_price_usd. The free preview is byte-identical to the paid route, so a
 * keyless install gets the REAL live gas price (never a stub).
 */
export function createBaseGasPrice(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async (): Promise<[string, GasPriceResult]> => {
      const out = await runGasPrice(payFetch, { base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "base_gas_price",
      description:
        "Current Base mainnet gas price via Grey Ridge /chain/gas-price ($0.002 USDC/call, paid inline with x402 — no API key). Returns EIP-1559 base_fee_gwei, priority_fee_gwei, gas_price_gwei/_wei and gas_price_usd. Use to time a Base transaction around cheap gas.",
      schema: z.object({}),
      responseFormat: "content_and_artifact",
    }
  );
}

/**
 * LangChain tool: current Base mainnet block number via Grey Ridge
 * `/chain/block-number` ($0.002 USDC/call, paid inline with x402 — no API key).
 * The free preview is byte-identical to the paid route, so a keyless install
 * gets the REAL current block.
 */
export function createBaseBlockNumber(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async (): Promise<[string, BlockNumberResult]> => {
      const out = await runBlockNumber(payFetch, { base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "base_block_number",
      description:
        "Current Base mainnet block number via Grey Ridge /chain/block-number ($0.002 USDC/call, paid inline with x402 — no API key). Use for chain height or confirmation math.",
      schema: z.object({}),
      responseFormat: "content_and_artifact",
    }
  );
}

/**
 * LangChain tool: ERC-20 token balance of a Base address via Grey Ridge
 * `/chain/token-balance` ($0.002 USDC/call, paid inline with x402 — no API key).
 * Returns symbol, decimals and the formatted balance. The free preview returns
 * the REAL balance for the given address+token, so a keyless install gets a real
 * number (never fabricated). `token` defaults to USDC on Base.
 */
export function createBaseTokenBalance(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async ({ address, token }: { address: string; token?: string }): Promise<[string, TokenBalanceResult]> => {
      const out = await runTokenBalance(payFetch, { address, token, base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "base_token_balance",
      description:
        "ERC-20 token balance of a Base mainnet address via Grey Ridge /chain/token-balance ($0.002 USDC/call, paid inline with x402 — no API key). Returns symbol, decimals, balance and balance_formatted. token defaults to USDC on Base.",
      schema: z.object({
        address: z.string().describe("0x-prefixed Base mainnet address to read the balance of (40 hex chars)."),
        token: z
          .string()
          .optional()
          .describe(`0x-prefixed ERC-20 contract on Base. Defaults to USDC (${BASE_USDC}).`),
      }),
      responseFormat: "content_and_artifact",
    }
  );
}

/**
 * LangChain tool: cross-venue perp funding rates via Grey Ridge
 * `/crypto/funding` ($0.004 USDC/call, paid inline with x402 — no API key).
 * Returns top coins by 24h notional volume with per-venue (Hyperliquid/OKX/dYdX)
 * funding, arb spread (bps), cheapest-long/richest-short venue, premium/basis,
 * annualized rates, a LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next funding time,
 * mark/oracle prices and open interest. Degrades OPEN to a free real top-1
 * sample when no funded wallet is configured.
 */
export function createCryptoFunding(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async ({ limit }: { limit?: number }): Promise<[string, FundingResult]> => {
      const out = await runFunding(payFetch, { limit, base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "crypto_funding",
      description:
        "Cross-venue perp funding rates (Hyperliquid + OKX + dYdX) via Grey Ridge /crypto/funding ($0.004 USDC/call, paid inline with x402 — no API key). Top coins by 24h volume with per-venue funding, arb spread (bps), cheapest-long/richest-short venue, premium, annualized rates, LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next_funding_ts, mark/oracle prices and open interest. Use for funding-rate arbitrage or perp positioning.",
      schema: z.object({
        limit: z.number().positive().default(20).describe("Max coins to return (1-100), ranked by 24h notional volume."),
      }),
      responseFormat: "content_and_artifact",
    }
  );
}

/**
 * LangChain tool: one-call crypto market brief via Grey Ridge `/brief/market`
 * ($0.01 USDC/call, paid inline with x402 — no API key). Returns the Fear &
 * Greed index, global market cap / 24h volume / BTC+ETH dominance, top 5
 * gainers and losers, trending coins and top DeFi fee earners — a full market
 * snapshot in one payment. There is no free preview for this composite route,
 * so a keyless install returns an activation hint (never a fabricated brief).
 */
export function createMarketBrief(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async (): Promise<[string, MarketBriefResult]> => {
      const out = await runMarketBrief(payFetch, { base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "market_brief",
      description:
        "One-call crypto market brief via Grey Ridge /brief/market ($0.01 USDC/call, paid inline with x402 — no API key). Returns Fear & Greed, global market cap + 24h volume + BTC/ETH dominance, top 5 gainers/losers, trending coins and top DeFi fee earners — a full market snapshot in one payment. Use when an agent needs the whole market picture at once.",
      schema: z.object({}),
      responseFormat: "content_and_artifact",
    }
  );
}

/**
 * LangChain tool: pre-trade token-safety verdict via Grey Ridge
 * `/chain/token-report` ($0.01 USDC/call, paid inline with x402 — no API key).
 * Answers "is this Base ERC-20 safe to buy?" with a decision-grade verdict —
 * SAFE | CAUTION | AVOID — a 0-100 risk_score and the reasons: honeypot /
 * sellability simulation, measured buy/sell tax, owner-renounced +
 * mint/pause/blacklist/fee-setter/upgradeable-proxy checks, owner supply %, and
 * Uniswap-v3 WETH-pool liquidity (USD). The free preview returns the SAME full
 * verdict for any token (capped at 3 real tokens/IP/day), so a keyless install
 * gets a REAL verdict — on a demo token when none is given, or on the caller's
 * token until the daily trial is spent, after which it honestly reports the
 * trial is exhausted and points at the paid route (never a fabricated verdict).
 */
export function createCheckToken(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool(
    async ({ token }: { token?: string }): Promise<[string, TokenReportResult]> => {
      const out = await runTokenReport(payFetch, { token, base }, { hasKey });
      return [JSON.stringify(out), out];
    },
    {
      name: "check_token",
      description:
        "Pre-trade token-safety verdict for a Base ERC-20 via Grey Ridge /chain/token-report ($0.01 USDC/call, paid inline with x402 — no API key). Returns SAFE/CAUTION/AVOID, a 0-100 risk_score and reasons: honeypot/sellability simulation, measured buy/sell tax, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, owner supply %, and Uniswap-v3 WETH-pool liquidity (USD). Call before buying or swapping a Base ERC-20 to avoid a rug/honeypot.",
      schema: z.object({
        token: z
          .string()
          .optional()
          .describe("0x-prefixed Base ERC-20 contract to check (40 hex chars). Omit to probe a demo token."),
      }),
      responseFormat: "content_and_artifact",
    }
  );
}

/** Zero-config tool instances: read `PRIVATE_KEY` (agent wallet) + optional `X402_DATA_BASE_URL` from env. */
export const defiYields = createDefiYields({ privateKey: envKey(), base: envBase() });
export const cryptoPrices = createCryptoPrices({ privateKey: envKey(), base: envBase() });
export const baseBalance = createBaseBalance({ privateKey: envKey(), base: envBase() });
export const baseGasPrice = createBaseGasPrice({ privateKey: envKey(), base: envBase() });
export const baseBlockNumber = createBaseBlockNumber({ privateKey: envKey(), base: envBase() });
export const baseTokenBalance = createBaseTokenBalance({ privateKey: envKey(), base: envBase() });
export const cryptoFunding = createCryptoFunding({ privateKey: envKey(), base: envBase() });
export const marketBrief = createMarketBrief({ privateKey: envKey(), base: envBase() });
export const checkToken = createCheckToken({ privateKey: envKey(), base: envBase() });

/** All nine data tools as a ready-to-spread array: `tools: [...defiDataTools]`. */
export const defiDataTools = [
  defiYields,
  cryptoPrices,
  baseBalance,
  baseGasPrice,
  baseBlockNumber,
  baseTokenBalance,
  cryptoFunding,
  marketBrief,
  checkToken,
];
