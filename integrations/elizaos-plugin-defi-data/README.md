# @grey-ridge/elizaos-plugin-defi-data

DeFi and market data for ElizaOS trading agents, paid inline per call with x402
USDC on Base. No API key, no account, no subscription — the agent's own wallet
signs each micropayment, from **$0.001/call**.

Most data plugins hand an agent raw numbers. This one leads with a **decision
layer** on a 99%-uptime, correctness-canaried source: a risk-adjusted score on
every yield pool, a per-pool go/no-go entry verdict, an OI-weighted funding-arb
read, and a SAFE/CAUTION/AVOID token verdict.

## Actions

| Action | Route | Price | What you get |
|--------|-------|-------|--------------|
| `GET_DEFI_YIELDS` | `/defi/yields` | $0.001 | Ranked lending/LP pools with APY + 1d/7d/30d trend, IL risk, TVL and a risk-adjusted score. |
| `YIELD_ENTRY_VERDICT` | `/defi/yield-entry-verdict` | $0.01 | Per-pool **SUSTAINABLE / DECAYING / OUTLIER / AVOID** + 0-100 risk score + field-cited reasons. |
| `GET_CRYPTO_PRICES` | `/crypto/prices` | $0.001 | Spot price + 24h change for up to 25 tokens, with a correctness canary. |
| `GET_FUNDING_RATES` | `/crypto/funding` | $0.004 | Cross-venue perp funding + an **OI-weighted** arb spread and LONGS_PAY/SHORTS_PAY signal. |
| `CHECK_TOKEN` | `/chain/token-report` | $0.01 | Pre-trade **SAFE / CAUTION / AVOID** verdict: honeypot sim, buy/sell tax, admin controls, liquidity. |

## Install

```bash
npm i @grey-ridge/elizaos-plugin-defi-data
```

Or build from source — the package lives at
`integrations/elizaos-plugin-defi-data/` in
[rezearcher/x402-data-api](https://github.com/rezearcher/x402-data-api); clone,
`cd` into that directory and run `npm install` (its `prepare` step builds `dist/`).

Register the plugin with your ElizaOS character/agent:

```ts
import { defiDataPlugin } from "@grey-ridge/elizaos-plugin-defi-data";

export const character = {
  name: "YieldScout",
  plugins: [defiDataPlugin],
  settings: {
    secrets: {
      // Omit to run keyless on the free preview (real data, limited depth).
      DEFI_DATA_PRIVATE_KEY: process.env.DEFI_DATA_PRIVATE_KEY,
    },
  },
};
```

## Configuration

| Setting | Required | Purpose |
|---------|----------|---------|
| `DEFI_DATA_PRIVATE_KEY` | no | Hex key of the agent's Base wallet; signs the x402 payment. Omit for keyless preview. |
| `DEFI_DATA_BASE_URL` | no | Override the data endpoint (defaults to the hosted Worker). |
| `DEFI_DATA_CHAIN` | no | Default chain filter for `GET_DEFI_YIELDS`. |
| `DEFI_DATA_POOL` | no | Default DefiLlama pool id for `YIELD_ENTRY_VERDICT`. |
| `DEFI_DATA_TOKEN` | no | Default Base ERC-20 for `CHECK_TOKEN`. |
| `DEFI_DATA_COINS` | no | Default coin list for `GET_CRYPTO_PRICES`. |

## Keyless by design

Without a funded wallet every action **degrades open**: it returns a real sample
from the free preview plus an activation hint telling the agent how to unlock
full depth. Nothing is ever fabricated — a spent trial or an unpriced pool is
reported honestly, never stubbed.

## Typical flow

1. `GET_DEFI_YIELDS` — find where the APY is.
2. `YIELD_ENTRY_VERDICT` — pass a pool's id to decide whether to actually enter it.
3. `CHECK_TOKEN` — screen the underlying token before funding.
4. `GET_FUNDING_RATES` / `GET_CRYPTO_PRICES` — read positioning and price around the trade.

MIT licensed. Built by Grey Ridge Signals Group LLC.
