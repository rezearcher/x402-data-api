Your trading agent already knows how to swap. What it does not know, on its own, is whether the token on the other side will let it sell again, or whether the order it is about to send is large enough to move the price against itself. Those are the two ways an autonomous agent on Base quietly loses real money: it buys into a honeypot it can never exit, or it fires a trade so big relative to the pool that slippage eats the position before the strategy ever plays out.

Most "token safety" tools answer only the first question. They tell you a contract looks like a honeypot or carries a hostile tax. That is useful and it is not enough, because a perfectly honest token with thin liquidity will still wreck a size that a bot picks on its own. The decision an agent needs before it signs is a single one: given this token, this side, and this notional, do I go, hold, or walk away. We built one call that answers it.

## One call, one word

`GET /gate/swap` takes a token address, a side, and a dollar notional, and returns a one-word decision with the reason behind it. Under the hood it runs a honeypot and sellability simulation, checks for the admin controls that let an owner freeze or confiscate (mint, pause, blacklist), and then measures your trade against the actual Uniswap v3 WETH-pool depth. Here is what the free preview returns right now for three real Base tokens.

USDC, a $500 buy:

```
decision: go      verdict label: SAFE    risk: 25
reason: token passes safety checks; trade is 0.00% of pool liquidity
```

DEGEN, a $500 buy:

```
decision: go      verdict label: SAFE    risk: 20    liquidity: $256,049
reason: token passes safety checks; trade is 0.20% of pool liquidity
```

Now the same DEGEN token, same contract, same safety profile, but a $200,000 buy:

```
decision: block   risk: 20    liquidity: $256,049    impact: 78.1% of pool
reason: trade is 78.1% of pool liquidity; severe price impact
```

That flip from go to block is the whole point. The token did not change. A honeypot-only checker would have waved both trades through, because the contract is not a honeypot. The $200k order is still a mistake, because it is 78% of the pool and the agent would pay for most of that impact itself. Honeypot and sizing live in the same answer, so your agent never has to stitch two services together and reconcile them.

## Why the number on the call matters

A pre-trade check only works if the agent can afford to run it on every decision. Price it like a SaaS seat and the economics push you toward sampling, or skipping the check on small trades, which is exactly where cheap honeypots hide. Our gate settles over x402 at $0.008 in USDC per call, paid inline by the agent at request time. No account, no key to rotate, no invoice. At that price you run it before every swap and stop reasoning about whether this one is worth checking.

The reason it can be that cheap is that it is Base-native and does one job. It is not a general risk platform with a per-call tariff to match. It is a gate you put in front of a swap.

## Wiring it into an agent

If your agent runs on a framework, this is a tool install, not an integration project. The ElizaOS action is about fifteen lines: wrap `fetch` with the x402 payment client, point it at `/gate/swap`, and return `go` as the boolean the rest of your flow already expects.

```js
export const swapGuardAction = {
  name: "CHECK_TOKEN_BEFORE_SWAP",
  description: "Pre-trade honeypot and sizing check for a Base token ($0.008 USDC).",
  handler: async (_rt, message, _s, options, callback) => {
    const token = options?.token ?? message.content.text.match(/0x[a-fA-F0-9]{40}/)?.[0];
    const r = await payFetch(
      `https://x402-data-api.sigrunner.workers.dev/gate/swap?token=${token}&side=buy&notional_usd=${options?.notional_usd ?? 100}`
    );
    const out = await r.json();
    callback({ text: `${out.decision}: ${out.reason}`, content: out });
    return out.decision === "go";
  },
};
```

The same pattern drops into a Vercel AI SDK tool or a LangChain tool. The gate is one route; the plugin is just the place your agent reaches for it.

## What the paid call adds

The free preview gives you the go/hold/block and the reason. The paid $0.008 call adds the part that sizes the downside: an exit simulation that tells you how much USD you would actually recover versus lose to slippage at $100, $1k, $10k, $50k, and at your own notional, plus the entry leg and the round-trip breakeven move the token has to make before you are even. That is the bounded-downside number a trading agent should be acting on, and it is the difference between knowing a token is sellable and knowing what selling it will cost.

## What this is and is not

This is a heuristic risk signal computed from on-chain state and simulation at the moment you call it. It is not financial advice, and a `go` is not a promise that a trade will be profitable or that a token is risk-free. Liquidity moves, owners act, and a verdict is true for the block it was computed on, not forever. What it does is take the two failure modes that cost autonomous agents real funds, honeypots and oversized orders, and collapse them into one decision your code can branch on before it signs.

Try it free on any Base token: paste an address into the [token check](https://x402-data-api.sigrunner.workers.dev/check), or call `GET /gate/swap/preview?token=...&side=buy&notional_usd=...` directly. The free preview is capped at three tokens per IP per day; the metered $0.008 call is unlimited and covers any Base ERC-20.
