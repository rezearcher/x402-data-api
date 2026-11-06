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
import { runYieldEntryVerdict, DATA_BASE } from "../data.mjs";
import { extractAddress } from "../parse.mjs";

function str(runtime: IAgentRuntime, key: string): string | undefined {
  const v = runtime.getSetting(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * The per-pool go/no-go that rides the #1-demand yields lane. After GET_DEFI_YIELDS
 * finds a high-APY pool, this answers "should I actually enter THIS pool?" with
 * SUSTAINABLE | DECAYING | OUTLIER | AVOID — the proprietary decision no rival
 * ElizaOS data plugin carries. Wraps Grey Ridge /defi/yield-entry-verdict ($0.01).
 */
export const getYieldEntryVerdict: Action = {
  name: "YIELD_ENTRY_VERDICT",
  similes: ["SHOULD_I_ENTER_POOL", "POOL_GO_NO_GO", "YIELD_DUE_DILIGENCE", "CHECK_POOL"],
  description:
    "Per-pool DeFi yield-entry go/no-go verdict via Grey Ridge /defi/yield-entry-verdict ($0.01 USDC/call, paid inline with x402 — no API key). Pass the DefiLlama pool id from GET_DEFI_YIELDS to get SUSTAINABLE/DECAYING/OUTLIER/AVOID + a 0-100 risk_score + field-cited reasons from the pool's APY 1d/7d/30d trend, DefiLlama stability forecast, impermanent loss, volatility and TVL. The proprietary rotate-or-stay decision rival data plugins do not offer. Call before funding a yield position.",

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = (message?.content?.text as string) || "";
    return (
      !!str(runtime, "DEFI_DATA_POOL") ||
      /\bpool\b/i.test(text) ||
      /[a-f0-9]{8}-[a-f0-9]{4}-/i.test(text)
    );
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
      // A DefiLlama poolId is a UUID-ish token; pull it from options/settings or text.
      const uuid = text.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
      const pool =
        (typeof options?.pool === "string" ? (options.pool as string) : undefined) ||
        str(runtime, "DEFI_DATA_POOL") ||
        (uuid ? uuid[0] : undefined);
      if (!pool) {
        const msg =
          "No DefiLlama pool id given. Run GET_DEFI_YIELDS first and pass a pool's `pool` field to get its entry verdict.";
        await callback?.({ text: msg });
        return { success: false, text: msg };
      }
      const token =
        (typeof options?.token === "string" ? (options.token as string) : undefined) ||
        extractAddress(text);

      const base = str(runtime, "DEFI_DATA_BASE_URL") || DATA_BASE;
      const privateKey = str(runtime, "DEFI_DATA_PRIVATE_KEY");
      const hasKey = typeof privateKey === "string" && privateKey.length > 0;
      const payFetch = makePayFetch(privateKey);

      const out = await runYieldEntryVerdict(payFetch, { pool, token, base }, { hasKey });
      const activation = (out as { activation?: { hint?: string } }).activation;
      const note = (out as { note?: string }).note;
      let text2 = out.summary;
      if (note) text2 += `\nℹ️ ${note}`;
      else if (activation?.hint) text2 += `\nℹ️ ${activation.hint}`;
      await callback?.({ text: text2, content: out });

      return {
        success: !out.error,
        text: text2,
        values: {
          verdict: out.verdict,
          risk_score: out.risk_score,
          is_sample: (out as { is_sample?: boolean }).is_sample === true,
          paid: out.paid === true,
          activation_needed: !!activation,
        },
        data: out as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const msg = `defi/yield-entry-verdict failed: ${(err as Error)?.message || err}`;
      await callback?.({ text: msg });
      return { success: false, text: msg, error: err as Error };
    }
  },
};
