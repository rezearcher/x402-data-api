// ElizaOS-style action: call before any Base swap. Same x402 client setup as ../swap-gate/gate.mjs.
// NOTE: this is the minimal teaching snippet. The real, installable, typed plugin
// (with sizing-aware go/no-go, agentConfig params, tests and registry metadata)
// lives at integrations/elizaos-plugin-swap-gate/ → `npm install @grey-ridge/elizaos-plugin-swap-gate`.
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.PRIVATE_KEY) });
const payFetch = wrapFetchWithPayment(fetch, client);

export const swapGuardAction = {
  name: "CHECK_TOKEN_BEFORE_SWAP",
  similes: ["HONEYPOT_CHECK", "TOKEN_SAFETY"],
  description: "Pre-trade honeypot/tax check for a Base token via Grey Ridge /gate/swap ($0.008 USDC).",
  validate: async () => !!process.env.PRIVATE_KEY,
  handler: async (_rt, message, _s, options, callback) => {
    const token = options?.token ?? message.content.text.match(/0x[a-fA-F0-9]{40}/)?.[0];
    const r = await payFetch(`https://x402-data-api.sigrunner.workers.dev/gate/swap?token=${token}&side=buy&notional_usd=${options?.notional_usd ?? 100}`);
    const out = await r.json();
    callback({ text: `${out.decision}: ${out.reason}`, content: out });
    return out.decision === "go";
  },
};
