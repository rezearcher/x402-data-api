import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";

type HandlerOptions = Record<string, unknown>;
import { makePayFetch } from "../client.js";
// Core money-logic lives in a dependency-free module so it is unit-tested
// without the agent runtime. Imported with the .mjs extension on purpose.
import { runYields, DATA_BASE } from "../data.mjs";

function str(runtime: IAgentRuntime, key: string): string | undefined {
  const v = runtime.getSetting(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Find where to earn yield. Wraps Grey Ridge /defi/yields ($0.001 USDC/call via
 * x402). Unlike a raw DefiLlama proxy, each pool carries a risk-adjusted score
 * and APY 1d/7d/30d trend — the decision layer rival data plugins lack.
 */
export const getDefiYields: Action = {
  name: "GET_DEFI_YIELDS",
  similes: ["FIND_YIELD", "BEST_APY", "YIELD_POOLS", "LENDING_RATES", "LP_YIELDS"],
  description:
    "Find the best DeFi lending/LP yields via Grey Ridge /defi/yields ($0.001 USDC/call, paid inline with x402 — no API key). Returns ranked pools with project, chain, symbol, APY + 1d/7d/30d trend, IL risk, TVL and a risk-adjusted score — a decision layer over raw DefiLlama data, on a 99%-uptime route with a correctness canary. Filter by project/chain/stablecoin; sort by TVL or risk-adjusted APY. Use to decide where to put capital to work.",

  validate: async (): Promise<boolean> => true,

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const text = (message?.content?.text as string) || "";
      const optLimit = typeof options?.limit === "number" ? (options.limit as number) : undefined;
      const project =
        (typeof options?.project === "string" ? (options.project as string) : undefined) ||
        str(runtime, "DEFI_DATA_PROJECT");
      const chain =
        (typeof options?.chain === "string" ? (options.chain as string) : undefined) ||
        str(runtime, "DEFI_DATA_CHAIN") ||
        (/\bbase\b/i.test(text) ? "Base" : undefined);
      const stable =
        typeof options?.stable === "boolean"
          ? (options.stable as boolean)
          : /\bstable(coin)?s?\b/i.test(text) || undefined;
      const sort =
        options?.sort === "risk_adjusted" || /risk[- ]adjust/i.test(text)
          ? "risk_adjusted"
          : "tvl";
      const limit = optLimit ?? 20;

      const base = str(runtime, "DEFI_DATA_BASE_URL") || DATA_BASE;
      const privateKey = str(runtime, "DEFI_DATA_PRIVATE_KEY");
      const hasKey = typeof privateKey === "string" && privateKey.length > 0;
      const payFetch = makePayFetch(privateKey);

      const out = await runYields(payFetch, { limit, project, chain, stable, sort, base }, { hasKey });
      const activation = (out as { activation?: { hint?: string } }).activation;
      const text2 = activation?.hint ? `${out.summary}\nℹ️ ${activation.hint}` : out.summary;
      await callback?.({ text: text2, content: out });

      return {
        success: !out.error,
        text: text2,
        values: {
          count: out.count,
          paid: out.paid === true,
          activation_needed: !!activation,
          top: Array.isArray(out.yields) ? out.yields[0] : null,
        },
        data: out as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const msg = `defi/yields failed: ${(err as Error)?.message || err}`;
      await callback?.({ text: msg });
      return { success: false, text: msg, error: err as Error };
    }
  },
};
