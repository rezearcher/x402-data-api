# Pull live DeFi yields into your Base agent with one x402 call

If you are building a trading or treasury agent on Base, "where is the best yield right now" is a question it has to answer constantly. The usual path is: sign up for a data API, manage a key, parse a firehose feed, and hope you stay under the rate limit. For an autonomous agent that pays its own way, that is a lot of human-shaped setup.

`GET /defi/yields` does it in one call, paid inline, no account and no API key. It is the single most-called route we serve by observed external demand — so this page is the honest walkthrough of exactly what you get, what it costs, and where it is *not* the right tool.

## What one keyless call returns

Before you pay a cent, the preview is live and open:

```
GET https://api.greyridgesignals.ai/defi/yields/preview?limit=3
```

Today that returns a real teaser row:

| project | symbol | APY | TVL (USD) | IL risk | exposure |
|---------|--------|-----|-----------|---------|----------|
| lido    | STETH  | 2.25% | $22,596,696,193 | none | single |

The preview hands back one live row so you can wire up parsing and confirm the shape before spending. The paid call returns the full ranked set with every field: `project`, `chain`, `symbol`, `pool`, `apy`, `apyBase`, `apyReward`, `apyPct1D/7D/30D`, `apyMean30d`, `tvlUsd`, `stablecoin`, `ilRisk`, `il7d`, `exposure`, `outlier`, `rewardTokens`, `underlyingTokens`. You can filter server-side by chain, project, stablecoin-only, and sort — so your agent asks for exactly the slice it needs instead of paging the whole feed.

## What it costs

```
GET https://api.greyridgesignals.ai/defi/yields?limit=10&chain=base&stable=true
→ HTTP 402 Payment Required
```

| field | value |
|-------|-------|
| price | 1000 µUSDC = **$0.001 per call** |
| asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| network | Base — `eip155:8453` |
| scheme | `exact` (EIP-3009 gasless USDC authorization) |

Your x402 client signs the challenge and retries automatically. No gas on your side, no key to rotate, no invoice at the end of the month — the agent pays a tenth of a cent as it calls.

## Dropping it into a framework

**LangChain (git install today):**

```bash
npm i github:rezearcher/langchain-defi-data
```

```ts
import { createDefiYields } from "@grey-ridge/langchain-defi-data"; // v0.4.1
const tools = [createDefiYields({ account })]; // account = your agent's own wallet
```

The tool wraps the route, signs the x402 payment with your agent's own key, and returns parsed rows. If the wallet is unfunded or payment is unavailable it **degrades open** to the keyless preview instead of throwing, so a missing balance never crashes your graph.

**Framework-agnostic:** point any `x402-fetch` client at the 402 challenge above — no package required.

## Where this is honest about its limits

- **The data is DefiLlama's.** DefiLlama runs an excellent, free yields API, and we are not pretending otherwise — we wrap it behind an x402 micropayment and a ready framework tool so an autonomous agent pays-per-call inline and filters server-side, instead of you managing a key and rate limit. If you are a human at a keyboard, DefiLlama direct is free and great; the wedge here is agent-native payment and packaging, not the numbers.
- **It is informational, not advice.** APY and TVL move every block; figures are point-in-time snapshots from upstream. The route reports yields — it does not tell your agent what to buy.
- **Yield is not safety.** A high APY row says nothing about whether the token is a honeypot or the protocol is sound. Pair this with a pre-trade check (`/chain/token-report`) before your agent actually deploys capital — the yield feed and the safety check are different jobs.

## Try it

- Keyless preview (no account): `https://api.greyridgesignals.ai/defi/yields/preview?limit=3`
- Full machine-readable manifest: `https://api.greyridgesignals.ai/.well-known/x402`
- Token-safety companion route: `https://api.greyridgesignals.ai/chain/token-report`

One call, a tenth of a cent, no key. That is the whole pitch.
