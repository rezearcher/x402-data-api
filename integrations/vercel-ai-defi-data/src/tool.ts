import { tool } from "ai";
import { z } from "zod";
import { makePayFetch, type PayFetch } from "./client.js";
// Core fetch/shaping logic lives in a dependency-free module so it is unit-
// tested without the AI SDK runtime. Imported with the .mjs extension on purpose.
import { runYields, runPrices, runBalance, runGasPrice, runBlockNumber, runTokenBalance, runFunding, runMarketBrief, runTokenReport, runYieldEntryVerdict, runSimulate, BASE_USDC, DATA_BASE } from "./data.mjs";

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
 * Vercel AI SDK tool: top DeFi lending/LP yields from DefiLlama via Grey Ridge
 * `/defi/yields` ($0.001 USDC/call, paid inline with x402 — no API key). Returns
 * ranked pools with APY trend, IL risk, TVL and a risk-adjusted score, plus a
 * one-line `summary`. Degrades OPEN to a free top-1 sample when no funded wallet
 * is configured (carries an `activation` hint), so a keyless install still works.
 *
 * ```ts
 * import { generateText } from "ai";
 * import { createDefiYields } from "@grey-ridge/vercel-ai-defi-data";
 * const defiYields = createDefiYields({ privateKey: process.env.PRIVATE_KEY });
 * await generateText({ model, tools: { defiYields }, prompt: "Best stablecoin yield on Base right now?" });
 * ```
 */
export function createDefiYields(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "Top DeFi lending/LP yields (DefiLlama) via Grey Ridge /defi/yields ($0.001 USDC/call, paid inline with x402 — no API key). Returns ranked pools with project, chain, symbol, APY + 1d/7d/30d trend, IL risk, TVL and a risk-adjusted score. Use to find where to earn yield. Filter by project/chain/stablecoin; sort by TVL or risk-adjusted APY.",
    inputSchema: z.object({
      limit: z.number().positive().default(20).describe("Max pools to return (1-100)."),
      project: z.string().optional().describe("Protocol filter, e.g. 'aave-v3'."),
      chain: z.string().optional().describe("Chain filter, e.g. 'Base' or 'Ethereum'."),
      stable: z.boolean().optional().describe("Stablecoin-only pools when true."),
      sort: z
        .enum(["tvl", "risk_adjusted"])
        .default("tvl")
        .describe("Rank by TVL (default) or risk-adjusted APY (apy/sigma)."),
    }),
    execute: async ({
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
    }) => runYields(payFetch, { limit, project, chain, stable, sort, base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: spot token prices from DefiLlama via Grey Ridge
 * `/crypto/prices` ($0.001 USDC/call, paid inline with x402 — no API key).
 * Pass comma-separated CoinGecko ids (up to 25); returns price, 24h change,
 * symbol, confidence and timestamp per token, plus a one-line `summary`.
 * Degrades OPEN to a free 1-token sample when no funded wallet is configured.
 */
export function createCryptoPrices(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "Spot token prices (DefiLlama) via Grey Ridge /crypto/prices ($0.001 USDC/call, paid inline with x402 — no API key). Pass comma-separated ticker symbols or CoinGecko ids (up to 25); returns price, change_24h, symbol, confidence and timestamp per token.",
    inputSchema: z.object({
      coins: z
        .string()
        .describe("Comma-separated ticker symbols or CoinGecko ids (max 25), e.g. 'ETH,BTC' or 'bitcoin,ethereum,solana'."),
    }),
    execute: async ({ coins }: { coins: string }) => runPrices(payFetch, { coins, base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: ETH balance of a Base address (incl. balance_usd) via
 * Grey Ridge `/chain/balance` ($0.002 USDC/call, paid inline with x402 — no API
 * key). There is no free preview for a live on-chain read, so a keyless install
 * returns an activation hint (no fabricated balance) rather than silently failing.
 */
export function createBaseBalance(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "ETH balance of a Base mainnet address, including balance_usd, via Grey Ridge /chain/balance ($0.002 USDC/call, paid inline with x402 — no API key). Use to read a wallet's native balance on Base.",
    inputSchema: z.object({
      address: z.string().describe("0x-prefixed Base mainnet address (40 hex chars)."),
    }),
    execute: async ({ address }: { address: string }) => runBalance(payFetch, { address, base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: current Base mainnet gas price via Grey Ridge
 * `/chain/gas-price` ($0.002 USDC/call, paid inline with x402 — no API key).
 * Returns EIP-1559 base_fee_gwei / priority_fee_gwei, gas_price_gwei/_wei and
 * gas_price_usd. The free preview is byte-identical to the paid route, so a
 * keyless install gets the REAL live gas price (never a stub). Use to decide
 * when a Base transaction is cheap to send.
 */
export function createBaseGasPrice(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "Current Base mainnet gas price via Grey Ridge /chain/gas-price ($0.002 USDC/call, paid inline with x402 — no API key). Returns EIP-1559 base_fee_gwei, priority_fee_gwei, gas_price_gwei/_wei and gas_price_usd. Use to time a Base transaction around cheap gas.",
    inputSchema: z.object({}),
    execute: async () => runGasPrice(payFetch, { base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: current Base mainnet block number via Grey Ridge
 * `/chain/block-number` ($0.002 USDC/call, paid inline with x402 — no API key).
 * The free preview is byte-identical to the paid route, so a keyless install
 * gets the REAL current block. Use for chain height / confirmation math.
 */
export function createBaseBlockNumber(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "Current Base mainnet block number via Grey Ridge /chain/block-number ($0.002 USDC/call, paid inline with x402 — no API key). Use for chain height or confirmation math.",
    inputSchema: z.object({}),
    execute: async () => runBlockNumber(payFetch, { base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: ERC-20 token balance of a Base address via Grey Ridge
 * `/chain/token-balance` ($0.002 USDC/call, paid inline with x402 — no API key).
 * Returns symbol, decimals and the formatted balance. The free preview returns
 * the REAL balance for the given address+token, so a keyless install gets a real
 * number (never fabricated). `token` defaults to USDC on Base.
 */
export function createBaseTokenBalance(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "ERC-20 token balance of a Base mainnet address via Grey Ridge /chain/token-balance ($0.002 USDC/call, paid inline with x402 — no API key). Returns symbol, decimals, balance and balance_formatted. token defaults to USDC on Base.",
    inputSchema: z.object({
      address: z.string().describe("0x-prefixed Base mainnet address to read the balance of (40 hex chars)."),
      token: z
        .string()
        .optional()
        .describe(`0x-prefixed ERC-20 contract on Base. Defaults to USDC (${BASE_USDC}).`),
    }),
    execute: async ({ address, token }: { address: string; token?: string }) =>
      runTokenBalance(payFetch, { address, token, base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: cross-venue perp funding rates via Grey Ridge
 * `/crypto/funding` ($0.004 USDC/call, paid inline with x402 — no API key).
 * Returns top coins by 24h notional volume with per-venue (Hyperliquid/OKX/dYdX)
 * funding, the arb spread (bps), cheapest-long/richest-short venue, premium/basis,
 * annualized rates, a LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next funding time,
 * mark/oracle prices and open interest. Degrades OPEN to a free real top-1 sample
 * when no funded wallet is configured. Use to find a funding-rate arbitrage or
 * to read market positioning before a perp trade.
 */
export function createCryptoFunding(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "Cross-venue perp funding rates (Hyperliquid + OKX + dYdX) via Grey Ridge /crypto/funding ($0.004 USDC/call, paid inline with x402 — no API key). Top coins by 24h volume with per-venue funding, arb spread (bps), cheapest-long/richest-short venue, premium, annualized rates, LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next_funding_ts, mark/oracle prices and open interest. Use for funding-rate arbitrage or perp positioning.",
    inputSchema: z.object({
      limit: z.number().positive().default(20).describe("Max coins to return (1-100), ranked by 24h notional volume."),
    }),
    execute: async ({ limit }: { limit?: number }) => runFunding(payFetch, { limit, base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: one-call crypto market brief via Grey Ridge
 * `/brief/market` ($0.01 USDC/call, paid inline with x402 — no API key). Returns
 * the Fear & Greed index, global market cap / 24h volume / BTC+ETH dominance, the
 * top 5 gainers and losers, trending coins and the top DeFi fee earners — a full
 * market snapshot in a single payment. There is no free preview for this
 * composite route, so a keyless install returns an activation hint (never a
 * fabricated brief) rather than silently failing.
 */
export function createMarketBrief(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "One-call crypto market brief via Grey Ridge /brief/market ($0.01 USDC/call, paid inline with x402 — no API key). Returns Fear & Greed, global market cap + 24h volume + BTC/ETH dominance, top 5 gainers/losers, trending coins and top DeFi fee earners — a full market snapshot in one payment. Use when an agent needs the whole market picture at once.",
    inputSchema: z.object({}),
    execute: async () => runMarketBrief(payFetch, { base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: pre-trade token-safety verdict via Grey Ridge
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
 * Use before an agent buys or swaps a Base ERC-20.
 */
export function createCheckToken(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "Pre-trade token-safety verdict for a Base ERC-20 via Grey Ridge /chain/token-report ($0.01 USDC/call, paid inline with x402 — no API key). Returns SAFE/CAUTION/AVOID, a 0-100 risk_score and reasons: honeypot/sellability simulation, measured buy/sell tax, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, owner supply %, and Uniswap-v3 WETH-pool liquidity (USD). Call before buying or swapping a Base ERC-20 to avoid a rug/honeypot.",
    inputSchema: z.object({
      token: z
        .string()
        .optional()
        .describe("0x-prefixed Base ERC-20 contract to check (40 hex chars). Omit to probe a demo token."),
    }),
    execute: async ({ token }: { token?: string }) => runTokenReport(payFetch, { token, base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: per-pool DeFi yield-entry go/no-go verdict via Grey Ridge
 * `/defi/yield-entry-verdict` ($0.01 USDC/call, paid inline with x402 — no API
 * key). After `defiYields` finds a high-APY pool, pass that pool's DefiLlama
 * `pool` id to get SUSTAINABLE | DECAYING | OUTLIER | AVOID + a 0-100 risk_score
 * + field-cited reasons (APY 1d/7d/30d trend, DefiLlama stability forecast, IL,
 * volatility, outlier flag, TVL). The free preview returns a SAMPLE verdict (the
 * current top-TVL pool), so a keyless install sees the shape but the verdict for
 * the caller's own pool is the paid route (degrades OPEN with is_sample:true —
 * never a fabricated verdict). Call before funding a yield position.
 */
export function createYieldEntryVerdict(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "Per-pool DeFi yield-entry go/no-go verdict via Grey Ridge /defi/yield-entry-verdict ($0.01 USDC/call, paid inline with x402 — no API key). Pass the DefiLlama pool id from defiYields/GET /defi/yields to get SUSTAINABLE/DECAYING/OUTLIER/AVOID + a 0-100 risk_score + field-cited reasons from the pool's APY trend (1d/7d/30d), stability forecast, impermanent loss, volatility, outlier flag and TVL. Call after defiYields finds a high-APY pool to decide whether to actually enter THAT pool before funding it.",
    inputSchema: z.object({
      pool: z
        .string()
        .describe("DefiLlama poolId — the 'pool' field returned by defiYields / GET /defi/yields."),
      token: z
        .string()
        .optional()
        .describe("Optional underlying token (0x, Base) — adds a honeypot-check pointer for the pool's asset."),
    }),
    execute: async ({ pool, token }: { pool: string; token?: string }) =>
      runYieldEntryVerdict(payFetch, { pool, token, base }, { hasKey }),
  });
}

/**
 * Vercel AI SDK tool: prospective-transaction dry-run via Grey Ridge
 * `/chain/simulate` ($0.005 USDC/call, paid inline with x402 — no API key).
 * Answers "will THIS Base tx revert, how much gas, what tokens move" BEFORE the
 * agent spends gas sending it, via eth_simulateV1: pass from/to and optional
 * calldata/value. The pre-trade check for any swap/approve/transfer and the
 * companion to checkToken. The free preview is a benign demo dry-run, so a
 * keyless install sees the output shape; the dry-run of the caller's own tx is
 * the paid route (degrades OPEN with is_sample:true — never a fabricated result).
 */
export function createSimulateTx(opts: DataToolOptions = {}) {
  const { base, payFetch, hasKey } = resolve(opts);
  return tool({
    description:
      "Prospective Base transaction dry-run via Grey Ridge /chain/simulate ($0.005 USDC/call, paid inline with x402 — no API key). Pass from, to and optional data (0x calldata) + value (wei) to get will_revert + revert_reason + gas_used + token asset_changes via eth_simulateV1 BEFORE the agent spends gas sending it. Tenderly/Alchemy-class output, keyless and Base-native. Call before any swap/approve/transfer, or alongside checkToken, to avoid a reverting or malicious tx.",
    inputSchema: z.object({
      from: z.string().describe("Sender 0x Base address (40 hex chars) — the wallet that would send the tx."),
      to: z.string().describe("Target contract or address (0x, Base) the tx calls."),
      data: z.string().optional().describe("Optional 0x-prefixed calldata (omit for a plain native transfer)."),
      value: z
        .string()
        .optional()
        .describe("Optional wei to send, as a decimal or 0x-hex string (omit or '0' for none)."),
    }),
    execute: async ({ from, to, data, value }: { from: string; to: string; data?: string; value?: string }) =>
      runSimulate(payFetch, { from, to, data, value, base }, { hasKey }),
  });
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
export const yieldEntryVerdict = createYieldEntryVerdict({ privateKey: envKey(), base: envBase() });
export const simulateTx = createSimulateTx({ privateKey: envKey(), base: envBase() });

/** All eleven data tools as a ready-to-spread toolset: `tools: { ...defiDataTools }`. */
export const defiDataTools = {
  defiYields,
  cryptoPrices,
  baseBalance,
  baseGasPrice,
  baseBlockNumber,
  baseTokenBalance,
  cryptoFunding,
  marketBrief,
  checkToken,
  yieldEntryVerdict,
  simulateTx,
};
