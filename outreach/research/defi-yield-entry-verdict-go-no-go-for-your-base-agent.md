# A go/no-go verdict on a DeFi pool, in one x402 call

Your agent queried `GET /defi/yields`, found a pool paying 40% APY, and now has to answer the only question that matters: *do I actually put money in?* Raw yield rows do not answer that. A 40% APY can be a healthy incentive program or a pool whose rewards collapsed last week and whose TVL is draining — the number alone does not tell you which.

`GET /defi/yield-entry-verdict` folds the pool's own data into a packaged decision: **SUSTAINABLE · DECAYING · OUTLIER · AVOID**, a 0–100 risk score, and field-cited reasons. One call, keyless, paid inline on Base. It is the decision layer that sits on top of the single most-paid route we serve.

## Why this exists

By observed external demand over the last 30 days, `/defi/yields` is tied for the most-called route we run (5 distinct external payers, level with `/crypto/prices`). Agents clearly want yield data. But the raw feed hands back ~20 fields per pool — `apy`, `apyPct1D/7D/30D`, `tvlUsd`, `il7d`, `sigma`, `outlier`, a stability forecast — and leaves every agent to re-implement the same risk logic to turn those into a decision. This route does that once, from the pool's own fields, so your agent gets a go/no-go instead of a spreadsheet.

## What one keyless call returns

The preview is live and open — no key, no payment:

```
GET https://api.greyridgesignals.ai/defi/yield-entry-verdict/preview
```

Today, for the current top-TVL pool, it returns a real verdict:

| field | value |
|-------|-------|
| pool | lido · STETH · Ethereum |
| verdict | **SUSTAINABLE** |
| risk_score | 0 / 100 |
| apy | 2.25% |
| apy 7d / 30d | +0.02% / −0.08% |
| sigma (volatility) | 0.054 |
| forecast | Stable/Up (71% probability) |
| TVL | $22,596,696,193 |
| reason | `stable_sustainable` — stable-or-up forecast, APY trend intact, adequate liquidity; no decay, outlier or liquidity flags |

The paid call takes any `?pool=<DefiLlama poolId from /defi/yields>` and returns the same shape for that pool.

## How the verdict is decided

The logic is not a black box. Each class is triggered by a named, published threshold applied to the pool's own fields, and the worst-matching flag wins:

| flag | condition | contributes to |
|------|-----------|----------------|
| forecast is "Down" with ≥60% probability | stability model | **AVOID** |
| 30-day APY change ≤ −50% | rewards collapsed | **AVOID** |
| TVL < $50,000 | exit-liquidity risk | **AVOID** |
| 7-day APY change ≤ −40% | fading | **DECAYING** |
| 30-day APY change ≤ −25% | fading | **DECAYING** |
| sigma ≥ 0.5 | volatile APY | **DECAYING** |
| \|7-day impermanent loss\| ≥ 5% | IL drag | risk add |
| APY flagged `outlier` by the source | too-good-to-be-true | **OUTLIER** |

If nothing trips, the pool is **SUSTAINABLE**. Pass an optional `?token=<0x underlying, Base>` and the response adds a pointer to our honeypot token-safety check for that asset.

## What it costs

```
GET https://api.greyridgesignals.ai/defi/yield-entry-verdict?pool=<poolId>
→ HTTP 402 Payment Required
```

| field | value |
|-------|-------|
| price | 10,000 µUSDC = **$0.01 per call** |
| asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| network | Base — `eip155:8453` |
| scheme | `exact` (EIP-3009 gasless USDC authorization) |

Your x402 client signs the challenge and retries automatically — no gas on your side, no key to rotate. At a penny a call, a treasury agent can verdict every candidate pool it finds and still spend less than one failed gas estimation.

## Where it fits — and where it does not

The honest pairing is: `/defi/yields` finds *what* is paying; `/defi/yield-entry-verdict` tells you whether to *enter* a specific pool. The 402 response even carries a `see_also` pointer back to the yields route so a router can chain them.

**Scope, stated plainly.** This is a heuristic risk signal built from DefiLlama's public pool fields (data © [DefiLlama](https://defillama.com), used under attribution). It is informational, not financial advice, and not a guarantee that a "SUSTAINABLE" pool is safe or that an "AVOID" pool will fail. It does not audit the pool's contracts or custody. Treat it as a fast first filter your agent runs before committing capital, not as the last word.

**Versus the alternatives.** DefiLlama's own yields API is excellent and free, but it hands you the raw fields and no packaged decision — you build the risk model. GoPlus and token scanners check the *token* for honeypots, not whether a *yield* is decaying. This route is the narrow piece in between: the entry decision, from the yield's own data, in one keyless call on Base.

It is one of 63 routes in our live x402 catalog. Point your agent at `https://api.greyridgesignals.ai/.well-known/x402` and it can discover and pay for this one directly.
