# @grey-ridge/langchain-defi-data

DeFi yields, token prices and Base balances for **LangChain.js** trading agents — paid inline per call with **x402 USDC on Base** (from **$0.001/call**), **no API key, no account, no subscription**.

Drop-in LangChain tools wrapping Grey Ridge's live x402 data routes:

| Tool | Route | Price | Returns |
|------|-------|-------|---------|
| `defiYields` | `/defi/yields` | $0.001 | Top lending/LP pools: project, chain, symbol, APY + 1d/7d/30d trend, IL risk, TVL, risk-adjusted score |
| `cryptoPrices` | `/crypto/prices` | $0.001 | Spot price, 24h change, symbol, confidence (≤25 CoinGecko ids) |
| `baseBalance` | `/chain/balance` | $0.002 | Native ETH balance + `balance_usd` for a Base address |

Upstream data is DefiLlama + Base RPC, served from a sub-cent Cloudflare Worker.

## Install

```bash
npm i @grey-ridge/langchain-defi-data
# or straight from git:
npm i github:rezearcher/langchain-defi-data
```

Peer deps: `@langchain/core` (>=0.2) and `zod` (>=3.23) — your agent already has them.

## Use

```ts
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { defiDataTools } from "@grey-ridge/langchain-defi-data";

// Zero-config: reads PRIVATE_KEY (the agent's Base wallet) from the environment.
const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o-mini" }),
  tools: defiDataTools, // [defiYields, cryptoPrices, baseBalance]
});

const res = await agent.invoke({
  messages: [{ role: "user", content: "What's the best stablecoin yield on Base right now, and the BTC price?" }],
});
```

Or construct a single tool explicitly:

```ts
import { createDefiYields } from "@grey-ridge/langchain-defi-data";
const defiYields = createDefiYields({ privateKey: process.env.PRIVATE_KEY });
```

Each tool uses LangChain's `responseFormat: "content_and_artifact"`, so the model
gets a readable string **and** your app gets the structured object on `.artifact`.

## Paying per call (x402)

Set `PRIVATE_KEY` to a Base wallet holding a little USDC. The tool signs an
[x402](https://x402.org) payment inline on each paid call — no API key, no
account, no subscription. ~1 USDC covers ~1000 yields/price calls.

```bash
export PRIVATE_KEY=0x...        # agent's own Base wallet
export X402_DATA_BASE_URL=...   # optional: override the hosted Worker
```

## Keyless? It still works (degrade-open)

With **no** `PRIVATE_KEY`, `defiYields` and `cryptoPrices` fall back to the
**free preview** — a real (1-row) sample plus an `activation` hint telling the
agent how to unlock full depth. `baseBalance` has no preview for a live on-chain
read, so keyless it returns an honest activation stub — **never a fabricated
balance**. The runners never throw into the agent loop; a true outage returns
`{ error, ... }` so your graph can branch on it.

## Options

`createDefiYields` / `createCryptoPrices` / `createBaseBalance` accept:

- `privateKey` — hex key of the agent's Base wallet (signs the x402 payment).
- `base` — override the data base URL (defaults to the hosted Grey Ridge Worker).
- `payFetch` — inject a pre-built paying fetch (mainly for tests).

## Companion

For the **pre-trade safety** side (honeypot / sellability / admin-control /
liquidity-vs-size before a swap), see
[`@grey-ridge/langchain-swap-gate`](https://github.com/rezearcher/langchain-swap-gate).

---

MIT · Grey Ridge Signals Group LLC · <https://x402-data-api.sigrunner.workers.dev>
