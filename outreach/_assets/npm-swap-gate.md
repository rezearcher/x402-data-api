# Install a pre-trade safety gate for your Base agent — one npm line

Your trading agent is one swap away from a honeypot. The token looks fine, the
quote looks fine, the buy goes through — and then the sell reverts, because a
real wallet was never allowed to sell. One bad token can cost more than a year
of safety checks.

**Grey Ridge Swap Gate** is a single tool you drop into your agent that runs
*before every swap*: is this token a honeypot, can you actually sell it, do its
admin controls let the deployer rug it, and is your order too big for the pool?
Your model gets the full verdict plus a single `proceed` boolean to branch on —
in one call. It ships as a native **Vercel AI SDK** tool and a native
**LangChain.js** tool, and you install it with one `npm install` line.

## Install

```bash
# Vercel AI SDK
npm install github:rezearcher/vercel-ai-swap-gate ai zod

# LangChain.js
npm install github:rezearcher/langchain-swap-gate @langchain/core zod
```

Each installs under its real package name (`@grey-ridge/vercel-ai-swap-gate`,
`@grey-ridge/langchain-swap-gate`) and builds on install, so `import` works with
no extra step. The x402 payment client (`viem`, `@x402/*`) is bundled — you only
add the SDK you already build your agent with (`ai` + `zod`, or `@langchain/core`
+ `zod`) as peer dependencies.

## Use

```ts
// Vercel AI SDK
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createSwapGuard } from "@grey-ridge/vercel-ai-swap-gate";

const swapGuard = createSwapGuard({
  privateKey: process.env.PRIVATE_KEY, // agent's Base wallet; signs the x402 payment
  defaultNotionalUsd: 100,
  maxBreakevenPct: 15,
  maxExitSlippagePct: 10,
});

await generateText({
  model: openai("gpt-4o"),
  tools: { swapGuard },
  prompt: "Should I buy $50 of 0x4ed4...efed on Base?",
});
```

```ts
// LangChain.js — identical API
import { createSwapGuard } from "@grey-ridge/langchain-swap-gate";
const swapGuard = createSwapGuard({ privateKey: process.env.PRIVATE_KEY });
```

The tool returns the full gate response **plus** `proceed` (boolean),
`guard_reasons`, and a one-line `summary` your agent can act on directly. A
companion `createTokenReport` tool screens a candidate token the same way.

## Try it free, keyless, before you pay a cent

Every data check has a free preview that needs no wallet and no key — point a
plain `fetch` at it and you get a real verdict:

```bash
curl "https://api.greyridgesignals.ai/gate/swap/preview?token=0x4200000000000000000000000000000000000006&notional_usd=100"
# → {"decision":"go","risk_score":0,"reason":"token passes safety checks; trade is 0.00% of pool liquidity", ...}
```

That is WETH returning a clean `go`. Point it at a honeypot and the decision
flips. When you want the paid, signed path the tool pays inline per call.

## What it costs

| Call | Price | How you pay |
|---|---|---|
| `/gate/swap` — pre-trade gate + sizing | **$0.008** / call | x402 USDC on Base, inline |
| `/chain/token-report` — full token report | **$0.01** / call | x402 USDC on Base, inline |

Payment is in **USDC** (`0x833589fC…02913`) on **Base** (`eip155:8453`). No API
key, no dashboard, no monthly subscription — the tool signs one micropayment per
call with the agent's own wallet.

## How it differs from the alternatives

- **GoPlus token API** — strong multi-chain security data, but it ships as a
  REST API behind an API-key signup; you wrap it into an agent tool yourself,
  and it does not size the check to *your* order against the pool.
- **Router / aggregator safety flags** — a buy-side sanity check, not a
  sellability simulation and not a round-trip (entry + exit) friction estimate.
- **Roll-your-own** — you can, but you rebuild honeypot detection, sellability
  simulation, admin-control parsing and liquidity-vs-size math, and you own the
  maintenance.

Grey Ridge Swap Gate is **Base-native**, ships ready-to-drop for the two SDKs
above, is **pay-per-call keyless** (no signup), and **fails closed**: if the
gate is ever unreachable the tool returns `proceed: false`, so an outage can
never green-light a swap.

## Scope — read this honestly

This is a **heuristic safety signal**, not a guarantee and not an audit. It
checks honeypot behaviour, sellability, admin controls (mint / pause /
blacklist / fee-setter / upgradeable proxy), measured transfer tax, and
Uniswap-v3 WETH-pool liquidity versus your order size. It does not prove a token
is "safe" and it does not replace reading the contract. Use it to **filter the
obvious traps before they cost your agent real funds**, and keep your own
position limits.

---

**Links**

- Vercel AI SDK tool: `npm i github:rezearcher/vercel-ai-swap-gate`
- LangChain.js tool: `npm i github:rezearcher/langchain-swap-gate`
- Try the free preview: https://api.greyridgesignals.ai/gate/swap/preview?token=0x4200000000000000000000000000000000000006&notional_usd=100
- The paid route: https://api.greyridgesignals.ai/gate/swap
- Agent discovery hub: https://api.greyridgesignals.ai/for-agents
