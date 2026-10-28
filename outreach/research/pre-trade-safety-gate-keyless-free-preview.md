If you build autonomous trading agents on Base, the pre-trade safety check is the one call you cannot skip — a honeypot, a sell-tax trap, or an order that is too big for the pool costs real funds the moment the agent fires. The problem with wiring one in is that most safety APIs make you sign up, get a key, and often fund a wallet before you can see a single verdict. So you never evaluate them against live tokens; you just guess.

Grey Ridge's pre-trade gate runs the full decision with **zero setup**. No wallet, no API key, no signup. You get a GO / HOLD / BLOCK verdict on any Base token two ways — one hosted call, or one `npx` command — and only pay the $0.008 when you want the exit-simulation and sizing numbers underneath. Here is the whole thing, verifiable right now.

## Try it keyless — two ways, no account

**Hosted, in your browser or `curl`:**

```
curl "https://api.greyridgesignals.ai/gate/swap/preview?token=0x4200000000000000000000000000000000000006&side=buy&notional_usd=500"
```

Right now that returns, for WETH:

```json
{
  "decision": "go",
  "verdict": "SAFE",
  "risk_score": 0,
  "liquidity_usd": 136227099,
  "impact_pct_of_pool": 0,
  "flags": ["no honeypot, deep liquidity, no high-risk admin controls detected"],
  "reason": "token passes safety checks; trade is 0.00% of pool liquidity",
  "disclaimer": "Heuristic risk signal, not financial advice or a guarantee."
}
```

**From a terminal, no install, no wallet:**

```
npx -y github:rezearcher/greyridge-x402-tools rugcheck 0x4200000000000000000000000000000000000006
```

That returns the full security read — `isHoneypot`, `sellable`, measured buy/sell/transfer tax in basis points, `taxMutable`, `ownerRenounced`, owner supply concentration — the same engine the hosted route uses, running against live Base state with no credential of any kind. The free preview is capped at three real tokens per IP per day; the demo tokens are unmetered.

That is the point: you can judge the gate on tokens you actually care about *before* you decide to wire it in. A rail you cannot evaluate keyless is a rail you will not adopt.

## The thing a token-safety API cannot tell you: your trade size

A honeypot checker answers one question — is this token a trap. That matters, but it is not the question that blows up a live trade on a thin pool. Watch what happens when the exact same safe token is checked against a large sell:

```
curl ".../gate/swap/preview?token=0x4200...0006&side=sell&notional_usd=5000000"
```

```json
{
  "decision": "hold",
  "verdict": "SAFE",
  "risk_score": 0,
  "impact_pct_of_pool": 3.67,
  "reason": "trade is 3.7% of pool liquidity; split the order"
}
```

Same token. Clean security. But the decision flipped from **GO to HOLD** — purely because a $5M sell is 3.7% of the WETH pool, and the gate tells the agent to split the order. A static token-safety API structurally cannot do this: it never sees your notional, so it will call WETH "safe" and let your agent eat the slippage. Pre-trade safety for an agent is *token safety and position sizing in one decision*, and that is the call we return.

## Honest positioning

[GoPlus](https://gopluslabs.io/) ships a solid, free, no-key token-security REST API, and if a plain REST integration is what you want, use it. Our gate is a different shape for a different buyer:

- **It is sizing-aware.** It reads your `notional_usd` against live Uniswap-v3 WETH-pool depth and returns a price-impact decision — the GO→HOLD flip above. A token-only API cannot.
- **It is built to live inside an agent.** It is an MCP tool and a set of framework plugins (ElizaOS, Vercel AI SDK, LangChain — `npm i github:rezearcher/...`, git-install today), so the check happens in the agent's trade path, not in a side service you have to glue in.
- **It settles inline over x402.** When you move past the free preview, the agent pays per decision — 8000 µUSDC ($0.008) on Base, no account, no monthly minimum. The free `/gate/swap/preview` keeps returning the verdict regardless.

We are not claiming to be cheaper than free. We are claiming a different delivery model — in-agent, keyless to try, sizing-aware — and you can confirm every line above with the two commands in this post.

## What the $0.008 call adds

The free preview gives you the decision. The paid `GET /gate/swap` ($0.008 USDC, Base, unmetered, any ERC-20) adds the bounded-downside numbers a sizing decision actually needs: an **exit simulation** (USD recoverable versus lost to slippage at $100 / $1k / $10k / $50k and for your own notional), the **entry leg** (tokens received, USD lost to entry slippage, round-trip breakeven move %), max-safe order size, and a one-line **sized verdict** that folds the GO/HOLD/BLOCK, pool-depth %, breakeven, and exit-recovery into a single field to act on. That is the number that tells an agent not just *whether* to trade but *how big*.

Every verdict is a heuristic risk signal, not financial advice or a guarantee, and `GO` is a point-in-time read, not a promise the token stays safe.

[Run the free preview](https://api.greyridgesignals.ai/gate/swap/preview?token=0x4200000000000000000000000000000000000006&side=buy&notional_usd=500) · [See the paid gate + sizing](https://api.greyridgesignals.ai/gate/swap) · [Free Base token check](https://api.greyridgesignals.ai/check)
