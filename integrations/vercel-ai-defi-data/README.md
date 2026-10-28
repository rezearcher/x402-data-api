# @grey-ridge/vercel-ai-defi-data

Drop-in **Vercel AI SDK tools** that give a Base trading agent live DeFi yields,
token prices and wallet balances — **paid inline per call in USDC on Base via
[x402](https://x402.org)**. No API key, no account, no subscription, no rate-limit
sign-up. Your agent's own wallet signs a sub-cent micropayment per call.

| Tool | Route | Price | Returns |
|------|-------|-------|---------|
| `defiYields` | `/defi/yields` | **$0.001** | Ranked lending/LP pools — project, chain, symbol, APY + 1d/7d/30d trend, IL risk, TVL, risk-adjusted score |
| `cryptoPrices` | `/crypto/prices` | **$0.001** | Spot price, 24h change, symbol, confidence, timestamp (up to 25 tokens) |
| `baseBalance` | `/chain/balance` | **$0.002** | ETH balance of a Base address incl. `balance_usd` |
| `baseGasPrice` | `/chain/gas-price` | **$0.002** | Base EIP-1559 gas — `base_fee_gwei`, `priority_fee_gwei`, `gas_price_gwei/_wei`, `gas_price_usd` |
| `baseBlockNumber` | `/chain/block-number` | **$0.002** | Current Base mainnet block height |
| `baseTokenBalance` | `/chain/token-balance` | **$0.002** | ERC-20 balance of a Base address — `symbol`, `decimals`, `balance`, `balance_formatted` (`token` defaults to USDC) |
| `cryptoFunding` | `/crypto/funding` | **$0.004** | Cross-venue perp funding (Hyperliquid/OKX/dYdX) — per-venue rate, arb spread (bps), cheapest-long/richest-short venue, LONGS_PAY/SHORTS_PAY signal |
| `marketBrief` | `/brief/market` | **$0.01** | One-call market snapshot — Fear & Greed, global market cap + BTC/ETH dominance, top gainers/losers, trending, top DeFi fee earners |
| `checkToken` | `/chain/token-report` | **$0.01** | Pre-trade token-safety verdict — `SAFE`/`CAUTION`/`AVOID`, 0-100 `risk_score`, honeypot/sellability sim, buy/sell tax, owner-renounced + mint/pause/blacklist/proxy checks, owner supply %, WETH-pool liquidity |

Data is sourced from DefiLlama and Base RPC.

The three Base-RPC reads (`baseGasPrice`, `baseBlockNumber`, `baseTokenBalance`)
back a **keyless install with the real live value** — their free preview is
identical to the paid route, so an agent with no wallet still gets the true gas
price, block height and token balance (never a stub or fabricated number); a
funded wallet simply moves the read onto the metered paid route.

## Install

```bash
npm install github:rezearcher/vercel-ai-defi-data
# peers you already have in an AI SDK agent:
npm install ai zod
```

The build is committed, so the git install needs no compile step.

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

Or wire a single tool with an explicit key:

```ts
import { createDefiYields } from "@grey-ridge/vercel-ai-defi-data";

const defiYields = createDefiYields({ privateKey: process.env.PRIVATE_KEY });
await generateText({ model, tools: { defiYields }, prompt: "Top 5 Base pools by TVL" });
```

### Environment

- `PRIVATE_KEY` — hex private key of the agent's Base wallet; signs the x402 USDC
  micropayment. Fund it with ~1 USDC to cover ~1000 calls.
- `X402_DATA_BASE_URL` — optional override of the hosted endpoint.

## Degrades open — a keyless install still works

With no `PRIVATE_KEY` (or an unfunded wallet), each tool returns a **real free
preview sample** plus an `activation` block telling the model exactly how to
unlock full results — instead of throwing an opaque `402`. So you can drop the
tools in, see real data immediately, and fund the wallet when you're ready. The
balance tool has no public preview, so keyless it returns the activation hint
rather than a fabricated number.

Every tool result carries a one-line `summary` the model can relay verbatim, a
`paid` boolean, and (when relevant) `guard_reasons`. Nothing throws into your
agent loop — a true outage returns `{ error, summary }`.

## Why this over hand-wiring fetch

A trading agent usually hand-wires `fetch` to DefiLlama/CoinGecko with no payment
rail, no sizing, and brittle rate limits. These tools are a drop-in toolset with
a built-in USDC payment rail, graceful degradation, and model-ready summaries —
the Vercel starter template gives you a whole Next.js app to wire yourself; this
is the installable tool.

## Primitives

The dependency-free core is exported for apps that want the raw calls:
`runYields`, `runPrices`, `runBalance`, the `build*Url` helpers, and the
`summarize*` formatters. All unit-tested offline and against the live endpoint.

## License

MIT · Grey Ridge Signals Group LLC · <https://x402-data-api.sigrunner.workers.dev>
