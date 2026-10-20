// Vercel AI SDK tool: block honeypot/scam swaps before your agent trades. $0.008 USDC/call via x402 on Base.
// Free sample (3/IP/day, any Base token): curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x..."
import { tool } from "ai";
import { z } from "zod";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.PRIVATE_KEY) });
const payFetch = wrapFetchWithPayment(fetch, client);

export const swapGuard = tool({
  description: "Check a Base ERC-20 for honeypot, tax and ownership risk BEFORE swapping. Returns go/hold/block.",
  parameters: z.object({ token: z.string(), side: z.enum(["buy", "sell"]).default("buy"), notional_usd: z.number().default(100) }),
  execute: async ({ token, side, notional_usd }) => {
    const r = await payFetch(`https://x402-data-api.sigrunner.workers.dev/gate/swap?token=${token}&side=${side}&notional_usd=${notional_usd}`);
    if (!r.ok) return { decision: "block", reason: `gate unavailable (${r.status}); fail closed` };
    return await r.json(); // decision: go | hold | block
  },
});
// usage: generateText({ model, tools: { swapGuard }, prompt: "Buy $50 of 0x... on Base" })
