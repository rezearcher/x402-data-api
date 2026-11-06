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
import { runTokenReport, DATA_BASE } from "../data.mjs";
import { extractAddress } from "../parse.mjs";

function str(runtime: IAgentRuntime, key: string): string | undefined {
  const v = runtime.getSetting(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Pre-trade token-safety verdict for a Base ERC-20 via Grey Ridge
 * /chain/token-report ($0.01 USDC/call via x402): SAFE | CAUTION | AVOID +
 * a 0-100 risk_score and the reasons (honeypot sim, buy/sell tax, admin
 * controls, owner supply %, Uniswap-v3 WETH liquidity). Call before buying.
 */
export const checkToken: Action = {
  name: "CHECK_TOKEN",
  similes: ["TOKEN_SAFETY", "IS_IT_SAFE", "RUG_CHECK", "HONEYPOT_CHECK", "SCREEN_TOKEN"],
  description:
    "Pre-trade token-safety verdict for a Base ERC-20 via Grey Ridge /chain/token-report ($0.01 USDC/call, paid inline with x402 — no API key). Returns SAFE/CAUTION/AVOID, a 0-100 risk_score and reasons: honeypot/sellability simulation, measured buy/sell tax, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, owner supply %, and Uniswap-v3 WETH-pool liquidity (USD). GoPlus/TokenSniffer-class, keyless over x402. Call before buying or swapping a Base ERC-20 to avoid a rug/honeypot.",

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = (message?.content?.text as string) || "";
    return !!extractAddress(text) || !!str(runtime, "DEFI_DATA_TOKEN");
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
      const token =
        (typeof options?.token === "string" ? (options.token as string) : undefined) ||
        str(runtime, "DEFI_DATA_TOKEN") ||
        extractAddress(text);

      const base = str(runtime, "DEFI_DATA_BASE_URL") || DATA_BASE;
      const privateKey = str(runtime, "DEFI_DATA_PRIVATE_KEY");
      const hasKey = typeof privateKey === "string" && privateKey.length > 0;
      const payFetch = makePayFetch(privateKey);

      // token is optional: runTokenReport falls back to an un-metered demo token
      // so a keyless probe still returns a real verdict shape.
      const out = await runTokenReport(payFetch, { token, base }, { hasKey });
      const activation = (out as { activation?: { hint?: string } }).activation;
      const text2 = activation?.hint ? `${out.summary}\nℹ️ ${activation.hint}` : out.summary;
      await callback?.({ text: text2, content: out });

      return {
        success: !out.error,
        text: text2,
        values: {
          verdict: out.verdict,
          risk_score: out.risk_score,
          trial_exhausted: (out as { trial_exhausted?: boolean }).trial_exhausted === true,
          paid: out.paid === true,
          activation_needed: !!activation,
        },
        data: out as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const msg = `chain/token-report failed: ${(err as Error)?.message || err}`;
      await callback?.({ text: msg });
      return { success: false, text: msg, error: err as Error };
    }
  },
};
