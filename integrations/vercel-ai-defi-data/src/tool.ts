import { tool } from "ai";
import { z } from "zod";
import { makePayFetch, type PayFetch } from "./client.js";
// Core fetch/shaping logic lives in a dependency-free module so it is unit-
// tested without the AI SDK runtime. Imported with the .mjs extension on purpose.
import { runYields, runPrices, runBalance, runGasPrice, runBlockNumber, runTokenBalance, BASE_USDC, DATA_BASE } from "./data.mjs";

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
      "Spot token prices (DefiLlama) via Grey Ridge /crypto/prices ($0.001 USDC/call, paid inline with x402 — no API key). Pass comma-separated CoinGecko ids (up to 25); returns price, change_24h, symbol, confidence and timestamp per token.",
    inputSchema: z.object({
      coins: z
        .string()
        .describe("Comma-separated CoinGecko ids (max 25), e.g. 'bitcoin,ethereum,solana'."),
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

/** Zero-config tool instances: read `PRIVATE_KEY` (agent wallet) + optional `X402_DATA_BASE_URL` from env. */
export const defiYields = createDefiYields({ privateKey: envKey(), base: envBase() });
export const cryptoPrices = createCryptoPrices({ privateKey: envKey(), base: envBase() });
export const baseBalance = createBaseBalance({ privateKey: envKey(), base: envBase() });
export const baseGasPrice = createBaseGasPrice({ privateKey: envKey(), base: envBase() });
export const baseBlockNumber = createBaseBlockNumber({ privateKey: envKey(), base: envBase() });
export const baseTokenBalance = createBaseTokenBalance({ privateKey: envKey(), base: envBase() });

/** All six data tools as a ready-to-spread toolset: `tools: { ...defiDataTools }`. */
export const defiDataTools = {
  defiYields,
  cryptoPrices,
  baseBalance,
  baseGasPrice,
  baseBlockNumber,
  baseTokenBalance,
};
