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
import { runPrices, DATA_BASE } from "../data.mjs";
import { extractCoins } from "../parse.mjs";

function str(runtime: IAgentRuntime, key: string): string | undefined {
  const v = runtime.getSetting(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Spot token prices via Grey Ridge /crypto/prices ($0.001 USDC/call via x402).
 * DefiLlama-backed with a correctness canary (empty/geo-blocked bodies are caught,
 * not served as a hollow $0) — the liveness guarantee rival price feeds lack.
 */
export const getCryptoPrices: Action = {
  name: "GET_CRYPTO_PRICES",
  similes: ["TOKEN_PRICE", "SPOT_PRICE", "PRICE_CHECK", "GET_PRICE", "CHECK_PRICE"],
  description:
    "Spot token prices via Grey Ridge /crypto/prices ($0.001 USDC/call, paid inline with x402 — no API key). Pass comma-separated ticker symbols or CoinGecko ids (up to 25); returns price, change_24h, symbol, confidence and timestamp per token. DefiLlama-backed with a correctness canary so a geo-blocked/empty upstream is caught rather than served as a hollow price. Use to read live prices before a trade.",

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = (message?.content?.text as string) || "";
    return !!str(runtime, "DEFI_DATA_COINS") || !!extractCoins(text);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const text = (message?.content?.text as string) || "";
      const coins =
        (typeof options?.coins === "string" ? (options.coins as string) : undefined) ||
        str(runtime, "DEFI_DATA_COINS") ||
        extractCoins(text);
      if (!coins) {
        const msg =
          "No tokens recognized. Name a coin (e.g. 'price of ETH and BTC') or pass a `coins` list.";
        await callback?.({ text: msg });
        return { success: false, text: msg };
      }

      const base = str(runtime, "DEFI_DATA_BASE_URL") || DATA_BASE;
      const privateKey = str(runtime, "DEFI_DATA_PRIVATE_KEY");
      const hasKey = typeof privateKey === "string" && privateKey.length > 0;
      const payFetch = makePayFetch(privateKey);

      const out = await runPrices(payFetch, { coins, base }, { hasKey });
      const activation = (out as { activation?: { hint?: string } }).activation;
      const text2 = activation?.hint ? `${out.summary}\nℹ️ ${activation.hint}` : out.summary;
      await callback?.({ text: text2, content: out });

      return {
        success: !out.error,
        text: text2,
        values: {
          count: Array.isArray(out.prices) ? out.prices.length : 0,
          paid: out.paid === true,
          activation_needed: !!activation,
          prices: out.prices,
        },
        data: out as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const msg = `crypto/prices failed: ${(err as Error)?.message || err}`;
      await callback?.({ text: msg });
      return { success: false, text: msg, error: err as Error };
    }
  },
};
