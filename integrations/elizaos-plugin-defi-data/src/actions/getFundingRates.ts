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
import { runFunding, DATA_BASE } from "../data.mjs";

function str(runtime: IAgentRuntime, key: string): string | undefined {
  const v = runtime.getSetting(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Cross-venue perp funding + an OI-weighted CEX↔DEX arb verdict via Grey Ridge
 * /crypto/funding ($0.004 USDC/call via x402). The arb spread is weighted by
 * open interest (thin venues excluded from the signal) — the positioning
 * decision layer rival funding feeds lack.
 */
export const getFundingRates: Action = {
  name: "GET_FUNDING_RATES",
  similes: ["FUNDING_RATES", "PERP_FUNDING", "FUNDING_ARB", "PERP_POSITIONING", "BASIS_TRADE"],
  description:
    "Cross-venue perp funding rates (Hyperliquid + OKX + dYdX + more) via Grey Ridge /crypto/funding ($0.004 USDC/call, paid inline with x402 — no API key). Top coins by 24h volume with per-venue funding, an OI-WEIGHTED arb spread (bps) that excludes thin venues, cheapest-long/richest-short venue, premium, annualized rates, a LONGS_PAY/SHORTS_PAY/NEUTRAL signal, next funding time and open interest. The positioning/arb decision layer, not a raw rate dump. Use for a funding-rate carry/arb or perp positioning before a trade.",

  validate: async (): Promise<boolean> => true,

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const limit = typeof options?.limit === "number" ? (options.limit as number) : 20;
      const base = str(runtime, "DEFI_DATA_BASE_URL") || DATA_BASE;
      const privateKey = str(runtime, "DEFI_DATA_PRIVATE_KEY");
      const hasKey = typeof privateKey === "string" && privateKey.length > 0;
      const payFetch = makePayFetch(privateKey);

      const out = await runFunding(payFetch, { limit, base }, { hasKey });
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
          top: Array.isArray(out.funding) ? out.funding[0] : null,
        },
        data: out as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const msg = `crypto/funding failed: ${(err as Error)?.message || err}`;
      await callback?.({ text: msg });
      return { success: false, text: msg, error: err as Error };
    }
  },
};
