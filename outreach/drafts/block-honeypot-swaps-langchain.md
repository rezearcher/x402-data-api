# A LangChain tool that blocks honeypot swaps before your agent trades

If you are building a trading agent in LangChain, the model can decide to buy any token it reads about. That is the point of an agent, and it is also where the money leaks out. One bad token and the wallet is drained before the next tool call runs. The common guard is a boolean "is this a honeypot" lookup. It is not enough, and the reason is worth sixty seconds.

## Why a honeypot yes/no misses the trade that actually hurts

The token that empties an agent is rarely the one a scanner labels a scam. It is the token that passes every surface check and still cannot be sold at the size the agent wants to trade. No real pool depth, a sell tax that only bites above a threshold, liquidity that looks fine at $100 and is gone at $10,000. A yes/no honeypot flag says nothing about whether your position is exitable.

Run our free preview against three Base tokens right now and the difference shows up (any Base ERC-20, 3 tokens per IP per day, no key):

- USDC returns `go`, risk 25, trade is 0.00% of a $228,632,156 pool. Deep, clean, safe to auto-buy.
- DEGEN returns `go`, risk 20, with the note that the trade is 0.04% of a $251,005 pool. Sized and exitable.
- WETH returns `hold`, risk 0, with the reason: "no verifiable Uniswap v3 WETH-pool liquidity, cannot confirm the position is exitable or size the trade, not safe to auto-buy."

That WETH result is the one to sit with. Risk score zero. Nothing about WETH is a scam. The gate still says `hold`, because it could not prove your agent would get back out at size. A honeypot boolean waves that through. The decision your agent needs is not "is this evil," it is "can I enter and exit this cleanly right now," and that is what `go` / `hold` / `block` answers.

## The tool, in a dozen lines of LangChain.js

This is the whole integration. It is a standard LangChain `tool` from `@langchain/core/tools`, it pays $0.008 USDC per call over x402 on Base, and it fails closed: if the gate is unreachable, it returns `block` instead of guessing.

```js
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
    const r = await payFetch(
      `https://x402-data-api.sigrunner.workers.dev/gate/swap?token=${token}&side=${side}&notional_usd=${notional_usd}`,
    );
    if (!r.ok) return JSON.stringify({ decision: "block", reason: `gate unavailable (${r.status}); fail closed` });
    return JSON.stringify(await r.json()); // decision: go | hold | block
  },
  {
    name: "swap_guard",
    description: "Check a Base ERC-20 for honeypot, tax and ownership risk BEFORE swapping. Returns go/hold/block.",
    schema: z.object({
      token: z.string(),
      side: z.enum(["buy", "sell"]).default("buy"),
      notional_usd: z.number().default(100),
    }),
  },
);
```

Bind it the way you bind any other tool, and your agent routes every buy through one safety call first:

```js
const agent = model.bindTools([swapGuard]);
```

Now a dead or slow gate blocks the trade rather than letting it through, and the model sees the reason string in the tool result so it can explain why it passed.

## Free verdict, paid sizing

The free preview returns the decision, the risk score, and the reason. It is capped at 3 tokens per IP per day, which is enough to try it and wire it up. The paid call at `/gate/swap`, $0.008 USDC each, drops the per-token cap and adds the two numbers that tell you how much a trade can cost you: an exit simulation of USD recoverable versus lost to slippage, and trade sizing against live pool depth. That is the bounded-downside figure a yes/no check never gives you, and it turns "looks fine" into a number you can put a stop on.

At $0.008 a decision, the check is a rounding error against a single bad fill, and it is a fraction of what standalone token-security APIs bill, which run up to $0.25 per call. One honeypot avoided pays for tens of thousands of checks.

## Where this is honest

This is a heuristic risk signal, not financial advice and not a guarantee. `go` means the token cleared the checks and the trade sizes cleanly against current liquidity, not that the token will always be safe. `hold` means the gate could not confirm exitability, which is a reason to pause, not proof of fraud. The gate reads public on-chain state and pool data. It does not move your funds and it does not sign anything. Your key stays in your agent. Every verdict carries the reason string, so you can log exactly why a trade was blocked.

The ElizaOS and Vercel AI SDK builds of this same gate live on our pre-trade safety pages. The tool above is the LangChain.js build, copy-paste ready. Point your agent at the free preview, watch `go`, `hold` and `block` come back on real tokens, then turn the paid call on when you want the exit math in front of every trade.
