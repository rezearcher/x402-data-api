# @grey-ridge/langchain-swap-gate

**Pre-trade token-safety gate for Base trading agents — a LangChain.js tool.**

Before your agent swaps an ERC-20 on Base, this tool checks it for the ways a
token takes your money: honeypots (can't sell), confiscatory transfer tax,
live admin controls (mint/blacklist/pause), and liquidity too thin for the
trade size. It wraps the Grey Ridge [`/gate/swap`](https://x402-data-api.sigrunner.workers.dev)
route, **paid inline per call with x402 USDC ($0.008/call)** — no API key, no
account, no subscription. The agent's own Base wallet signs the micropayment.

It **fails closed**: if the gate is unreachable, times out, or the payment
doesn't settle, the tool returns `proceed: false` / `decision: "block"`. An
outage can never green-light a swap.

## Install

```bash
npm install @grey-ridge/langchain-swap-gate @langchain/core zod
```

`@langchain/core` and `zod` are peer dependencies — the stack you already build your agent with.

## Use

```ts
import { createSwapGuard } from "@grey-ridge/langchain-swap-gate";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const swapGuard = createSwapGuard({
  privateKey: process.env.PRIVATE_KEY, // the agent's Base wallet; signs the x402 payment
  maxBreakevenPct: 15,                 // skip trades whose round-trip friction is too high
  maxExitSlippagePct: 10,              // skip trades you can't exit cleanly
});

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [swapGuard],
});

await agent.invoke({
  messages: [{ role: "user", content: "Buy $50 of 0x4200000000000000000000000000000000000006 on Base" }],
});
```

Or drop in the zero-config instance, which reads `PRIVATE_KEY` (and optional
`SWAP_GATE_BASE_URL`) from the environment:

```ts
import { swapGuard } from "@grey-ridge/langchain-swap-gate";
const agent = createReactAgent({ llm, tools: [swapGuard] });
```

## Second tool: `token_report` (token screening)

`swapGuard` is the final gate *at the moment you swap*, sized to a notional.
`createTokenReport()` is the companion for **screening a candidate token
earlier** — a research or watchlist step that answers "is this token worth
trading at all?" without a trade size. It wraps `/chain/token-report`
(**$0.01 USDC/call**) and returns a `SAFE | CAUTION | AVOID` verdict with
`risk_score`, the full security breakdown, and a single `safe` boolean. It uses
the same `content_and_artifact` response format and **fails closed**
(`safe: false`, verdict `AVOID`) if the route is unreachable.

```ts
import { createSwapGuard, createTokenReport } from "@grey-ridge/langchain-swap-gate";

const tokenReport = createTokenReport({ privateKey: process.env.PRIVATE_KEY });
const swapGuard = createSwapGuard({ privateKey: process.env.PRIVATE_KEY });

// Wire BOTH into one agent: token_report to screen candidates, swap_guard to clear the order.
const agent = createReactAgent({ llm, tools: [tokenReport, swapGuard] });
```

A zero-config `tokenReport` is exported too (reads `PRIVATE_KEY` from env).

## What the tool returns

The tool is registered with `responseFormat: "content_and_artifact"`, so the
model gets a JSON string **and** your app gets the structured object on the
`ToolMessage.artifact`. The object is the full gate verdict plus:

| field | meaning |
|-------|---------|
| `proceed` | `true` only if the gate said **go** *and* the sizing-aware friction checks passed. Branch on this. |
| `decision` | `go` \| `hold` \| `block` from the gate. |
| `guard_reasons` | human-readable reasons the guard cleared or refused. |
| `summary` | one-line summary, e.g. `GO: risk 25/100 · liquidity $158,115,578`. |
| `risk_score`, `liquidity_usd`, `flags`, `sizing`, … | the raw gate response fields. |

## Try it free, no wallet

The free preview (3/IP/day, any Base token) needs no payment:

```bash
curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x4200000000000000000000000000000000000006"
```

## Design

- **Dependency-free core.** All money logic (`buildGateUrl`, `evaluateTrade`,
  `runGuard`, …) lives in `gate.mjs` with zero framework or x402 imports, so it
  is unit-tested offline and against the live endpoint — independent of the
  LangChain runtime. Re-exported for agents that want the raw primitives.
- **Payment isolated.** `client.ts` builds the x402-paying fetch from your
  private key; without a key it falls back to plain `fetch` (free preview path
  only).
- **Degrades open, never opaque.** With no key — or a key whose wallet is not
  yet funded (paid call `402`s) — `swapGuard` returns a real `proceed` from the
  free preview and appends a fund-onramp hint to `guard_reasons`, instead of
  throwing. A fresh install keeps blocking honeypots while you wire the wallet;
  it fails **closed** only if both the paid route and the preview are down.

## What it is and isn't

This is a **safety gate, not financial advice**. "go" means the token cleared a
set of mechanical safety checks at scan time — it is not a prediction that the
trade is profitable, and token state can change block to block. You keep full
control of execution; the tool only tells your agent whether to proceed.

---

Grey Ridge Signals Group LLC · [greyridgesignals.ai](https://x402-data-api.sigrunner.workers.dev) · MIT
