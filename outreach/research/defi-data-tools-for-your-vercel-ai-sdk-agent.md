Most of the work in giving a trading agent market data is not the model — it is the plumbing. You want the agent to answer "what's the best stablecoin yield right now, and what's ETH trading at?" and act on it. To get there you usually sign up for a data provider, mint an API key, read the rate-limit docs, store the secret, and write a fetch-and-rank layer. Or you point at a free source like DefiLlama and discover its `/pools` endpoint returns about 16,000 unranked pools in an 11 MB payload that your agent now has to pull and score on every decision.

`@grey-ridge/vercel-ai-defi-data` collapses that into one install. It is a set of drop-in [Vercel AI SDK](https://sdk.vercel.ai) tools that give a Base agent live DeFi yields, token prices, and wallet balances — paid inline, per call, in USDC on Base via [x402](https://x402.org). No API key, no account, no subscription, no rate-limit sign-up. The agent's own wallet signs a sub-cent micropayment per call.

## Install

```bash
npm install github:rezearcher/vercel-ai-defi-data
# peers you already have in an AI SDK agent:
npm install ai zod
```

The build is committed in the repo, so the git install needs no compile step. (The package also carries the scope name `@grey-ridge/vercel-ai-defi-data` for imports; the git URL above is the install path today.)

## The three tools

| Tool | Route | Price | Returns |
|------|-------|-------|---------|
| `defiYields` | `/defi/yields` | $0.001 | Ranked lending/LP pools — project, chain, symbol, APY with 1d/7d/30d trend, IL risk, TVL, risk-adjusted score |
| `cryptoPrices` | `/crypto/prices` | $0.001 | Spot price, 24h change, symbol, confidence, timestamp (up to 25 tokens in one call) |
| `baseBalance` | `/chain/balance` | $0.002 | ETH balance of a Base address including `balance_usd` |

Prices are the live x402 micropayment amounts quoted by each route (1000, 1000, and 2000 micro-USDC respectively). Data is sourced from DefiLlama and Base RPC.

## Use

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { defiDataTools } from "@grey-ridge/vercel-ai-defi-data";

// defiDataTools reads PRIVATE_KEY (your agent's Base wallet) from the env.
const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: { ...defiDataTools },
  prompt: "What's the best stablecoin yield right now, and what's ETH trading at?",
});
```

Or wire one tool with an explicit key via the `createDefiYields({ privateKey })` factory.

## What this does that a raw provider does not

The honest wedge here is the delivery model, not the price of the underlying data — DefiLlama is free, and so is a CoinGecko free tier. What the free paths cost you is integration:

- **Versus a keyed API (CoinGecko and similar):** those need an account, a key in your secret store, and a rate-limit tier. This needs none — the agent pays per call from its own wallet. Nothing to provision before the agent's first request.
- **Versus raw DefiLlama:** the free `/pools` feed is ~16,000 pools in one ~11 MB response, unranked, with no risk-adjusted score. `defiYields` returns a ranked, risk-scored top slice in a single call, so the agent is not fetching and sorting megabytes mid-decision.
- **Versus on-chain feeds (Chainlink and similar):** those are reliable for major pairs but need an RPC endpoint, the ABI, and on-chain reads, and they do not cover long-tail pool yields. These are plain HTTP tools the SDK already knows how to call.

## It works before you fund a wallet

Each tool degrades open. With no funded wallet present, it calls the free `/preview` path and returns a real sample plus an activation hint, instead of throwing into your agent loop. A true outage returns `{ error, summary }` rather than an exception. `baseBalance` has no preview, so with no wallet it returns an honest activation stub — never a fabricated balance.

That means you can drop the tools in and watch the agent reason over live data on day one, then fund the wallet to unlock full results.

## Live right now

A free preview call to the price route, point-in-time:

```json
{"id":"bitcoin","symbol":"BTC","price":80823.03,"change_24h":1.17,"confidence":0.99,"timestamp":1793167854}
```

And the top yields row from the yields preview:

```json
{"project":"lido","chain":"Ethereum","symbol":"STETH","apy":2.27,"tvlUsd":22781534491,"ilRisk":"no","risk_adjusted_apy":42.05}
```

Numbers move call to call; treat any single figure as a snapshot. `confidence` and the APY stability forecast are passed through from DefiLlama.

## Scope

These tools return market and on-chain **data** — prices, yields, balances. They are not financial advice, not a recommendation to enter any position, and not a safety guarantee about any token or pool. An agent should combine them with its own risk checks before acting. (For a pre-trade honeypot and sizing check on a specific swap, that is a separate route, `/gate/swap`.)

## Try it

- Install: `npm install github:rezearcher/vercel-ai-defi-data`
- Browse every route an agent can call: [api.greyridgesignals.ai/for-agents](https://api.greyridgesignals.ai/for-agents)
- The yields route in depth: [keyless DeFi yields for Base agents](https://api.greyridgesignals.ai/research/keyless-defi-yields-api-for-base-trading-agents)
- The price route in depth: [keyless crypto price feed for Base agents](https://api.greyridgesignals.ai/research/keyless-crypto-price-feed-for-base-agents)

One install, three tools, inline sub-cent payments from the agent's own wallet. No key to provision, no quota to watch.
