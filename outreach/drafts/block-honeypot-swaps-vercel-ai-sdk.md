# A Vercel AI SDK tool that blocks honeypot swaps before your agent trades

If you are building an autonomous trading agent on the Vercel AI SDK, the model can decide to buy any token it reads about. That is the whole point, and it is also the hole. One bad token and the wallet is gone before the next tool call runs. The usual fix is a boolean "is this a honeypot" lookup. It is not enough, and the reason is worth sixty seconds.

## Why a honeypot yes/no misses the trade that actually hurts

The token that drains an agent is rarely the one a scanner labels "scam." It is the token that passes every surface check and still cannot be exited at the size the agent wants to trade. No real pool depth, a sell tax that only bites above a threshold, liquidity that looks fine at $100 and vanishes at $10,000. A yes/no honeypot flag says nothing about whether your position is exitable.

Run our free preview against three Base tokens right now and you can see the difference (any Base ERC-20, 3 tokens per IP per day, no key):

- USDC returns `go`, risk 15. Deep pool, clean, safe to auto-buy.
- DEGEN returns `go`, risk 20, with the note that the trade is 0.04% of a $251,979 pool. Sized and exitable.
- WETH returns `hold`, risk 0, with the reason: "no verifiable Uniswap v3 WETH-pool liquidity, cannot confirm the position is exitable or size the trade, not safe to auto-buy."

That WETH result is the one to sit with. Risk score zero. Nothing about WETH is a scam. The gate still says `hold`, because it could not prove your agent would be able to get back out at size. A honeypot boolean would have waved it through. The decision your agent needs is not "is this evil," it is "can I enter and exit this cleanly right now," and that is what `go` / `hold` / `block` answers.

## The tool, in about eighteen lines

This is the whole integration. It is a standard Vercel AI SDK `tool`, it pays $0.008 USDC per call over x402 on Base, and it fails closed: if the gate is unreachable, it returns `block` instead of guessing.

```js
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
  parameters: z.object({
    token: z.string(),
    side: z.enum(["buy", "sell"]).default("buy"),
    notional_usd: z.number().default(100),
  }),
  execute: async ({ token, side, notional_usd }) => {
    const r = await payFetch(
      `https://x402-data-api.sigrunner.workers.dev/gate/swap?token=${token}&side=${side}&notional_usd=${notional_usd}`,
    );
    if (!r.ok) return { decision: "block", reason: `gate unavailable (${r.status}); fail closed` };
    return await r.json();
  },
});
```

Wire it in the way you wire any other tool:

```js
generateText({ model, tools: { swapGuard }, prompt: "Buy $50 of 0x... on Base" })
```

Now every buy the agent reasons its way into passes through one safety call first, and a dead or slow gate blocks the trade rather than letting it through.

## Free verdict, paid sizing

The free preview returns the decision, the risk score, and the reason. It is capped at 3 tokens per IP per day, which is enough to try it and wire it up. The paid call at `/gate/swap`, $0.008 USDC each, drops the per-token cap and adds the two numbers that tell you how much a trade can actually cost you: an exit simulation (USD recoverable versus lost to slippage at $100, $1k, $10k, $50k and at your own notional) and trade sizing against live pool depth. That is the bounded-downside figure a yes/no check never gives you, and it is what turns "looks fine" into a number you can put a stop on.

At $0.008 a decision, the check is a rounding error against a single bad fill, and it is a fraction of what standalone token-security APIs bill per call. One honeypot avoided pays for tens of thousands of checks.

## Where this is honest

This is a heuristic risk signal, not financial advice and not a guarantee. `go` means the token cleared the checks and the trade sizes cleanly against current liquidity, not that the token will always be safe. `hold` means the gate could not confirm exitability, which is a reason to pause, not proof of fraud. The gate reads public on-chain state and pool data; it does not move your funds and it does not sign anything. Your key stays in your agent. We publish the reason string on every verdict so you can log exactly why a trade was blocked.

The ElizaOS version of this action lives on our pre-trade safety page. The tool above is the Vercel AI SDK build, copy-paste ready. Point your agent at the free preview, watch `go`, `hold` and `block` come back on real tokens, then flip the paid call on when you want the exit math in front of every trade.
