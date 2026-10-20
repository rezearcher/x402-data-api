// LangChain.js tool: block honeypot/scam swaps before your agent trades. $0.008 USDC/call via x402 on Base.
// Free sample (3/IP/day, any Base token): curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x..."
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.PRIVATE_KEY) });
const payFetch = wrapFetchWithPayment(fetch, client);

export const swapGuard = tool(
  async ({ token, side, notional_usd }) => {
    const r = await payFetch(`https://x402-data-api.sigrunner.workers.dev/gate/swap?token=${token}&side=${side}&notional_usd=${notional_usd}`);
    return JSON.stringify(await r.json()); // decision: go | hold | block
  },
  {
    name: "swap_guard",
    description: "Check a Base ERC-20 for honeypot, tax and ownership risk BEFORE swapping. Returns go/hold/block.",
    schema: z.object({ token: z.string(), side: z.enum(["buy", "sell"]).default("buy"), notional_usd: z.number().default(100) }),
  }
);
