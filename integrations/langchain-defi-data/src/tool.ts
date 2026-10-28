import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { makePayFetch, type PayFetch } from "./client.js";
// Core fetch/shaping logic lives in a dependency-free module so it is unit-
// tested without the LangChain runtime. Imported with the .mjs extension on purpose.
import {
  runYields,
  runPrices,
  runBalance,
  DATA_BASE,
  type YieldsResult,
  type PricesResult,
  type BalanceResult,
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

/** Zero-config tool instances: read `PRIVATE_KEY` (agent wallet) + optional `X402_DATA_BASE_URL` from env. */
export const defiYields = createDefiYields({ privateKey: envKey(), base: envBase() });
export const cryptoPrices = createCryptoPrices({ privateKey: envKey(), base: envBase() });
export const baseBalance = createBaseBalance({ privateKey: envKey(), base: envBase() });

/** All three data tools as a ready-to-spread array: `tools: [...defiDataTools]`. */
export const defiDataTools = [defiYields, cryptoPrices, baseBalance];
