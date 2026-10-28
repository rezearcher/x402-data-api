# Keyless DeFi yields for your Base trading agent — ranked, risk-scored, $0.001 a call

If you build an autonomous trading or treasury agent on Base, at some point it has to answer a boring-but-expensive question: *where is yield right now, and which pools are worth the risk?* The canonical source is DefiLlama — and it is free. So the honest first question is not "which paid API," it's **"why pay anything at all?"**

Here is the real trade-off, measured today.

## The free source is a firehose

DefiLlama's public yields endpoint (`https://yields.llama.fi/pools`) is keyless and free. We pulled it live while writing this:

```
GET https://yields.llama.fi/pools
HTTP 200 · 16,157 pools · 11,081,552 bytes (~11 MB)
```

Sixteen thousand pools in an 11 MB JSON blob. For a human with a notebook, perfect. For an agent that needs *an answer in a prompt budget*, that payload is the problem: it must fetch all 11 MB, filter to the chains and assets it cares about, dedupe, and then **rank** — because the raw feed is unordered and carries no computed risk-adjusted score. We checked the raw fields: it ships `mu`, `sigma`, `il7d`, `apyPct7D` and a `predictions` block, but there is **no `risk_adjusted_apy`** — you compute that yourself, every call, forever, and you own that code.

That ranking + risk layer is exactly what you pay $0.001 for — or don't, if you'd rather maintain it.

## What the paid route hands your agent instead

`GET /defi/yields` returns the **ranked, risk-scored top-N** in one small call. Free top-1 preview, pulled live just now:

```
GET https://api.greyridgesignals.ai/defi/yields/preview
{
  "project": "lido", "chain": "Ethereum", "symbol": "STETH",
  "apy": 2.27, "apyPct1D": 0.033, "apyPct7D": 0.047, "apyPct30D": 0.085,
  "tvlUsd": 22862015656, "ilRisk": "no", "il7d": null, "exposure": "single",
  "mu": 3.396, "sigma": 0.054,
  "risk_adjusted_apy": 42.05,
  "predicted_probability": 70,
  "outlier": false
}
```

Everything your agent needs to *decide* in one object: APY plus its 1d/7d/30d trend, impermanent-loss risk (`ilRisk` + `il7d`), single-vs-multi exposure, `risk_adjusted_apy` (APY ÷ volatility — **we compute this; the raw feed does not**), DefiLlama's own stability forecast surfaced as `predicted_probability`, an outlier flag, and TVL. Filter by `project`, `chain`, or `stable=true`; sort by TVL or risk-adjusted APY. The full ranked set is `GET /defi/yields?limit=20` for **$0.001**.

## Why keyless x402 matters for an agent

No account, no dashboard, no API key to provision or rotate. Until it is paid, the route returns a standard **HTTP 402 Payment Required**; your agent settles it inline in USDC on Base and reads the data. We traced the live 402 for this route:

```
GET /defi/yields  →  402 Payment Required
accepts[0]: { scheme:"exact", network:"eip155:8453",
  amount:"1000", asset:USDC(0x8335…2913), payTo:0x5765… }
```

`amount: 1000` is µUSDC — six decimals — so **$0.001 a call**. No key means nothing to leak, nothing to expire, nothing in a secrets manager. The whole catalog wires from one file your agent already knows how to read: the [x402 catalog](https://api.greyridgesignals.ai/.well-known/x402?ref=greyridge), the [OpenAPI spec](https://api.greyridgesignals.ai/openapi.json?ref=greyridge), or the human-readable [data-API catalog for agents](https://api.greyridgesignals.ai/for-agents?ref=greyridge).

## Honest positioning

- **vs DefiLlama (free):** DefiLlama is the canonical source and it is excellent. If your agent can afford to pull 11 MB and you want to own the ranking + risk-scoring code, use it directly — genuinely. We sell the *pre-computed decision layer* (ranked, `risk_adjusted_apy`, IL flag, forecast) delivered keyless over x402, not the raw data. Different job.
- **vs key-gated data APIs:** most require signup, a dashboard and a secret key before an agent reads a byte. An autonomous agent can't click a signup form. Keyless-pay-per-call is the point.
- We do **not** rank ourselves above the source on data accuracy — the underlying numbers are DefiLlama's. The edge is delivery and the computed layer, nothing more.

## Two more routes agents actually pay for

The same keyless pattern across the rest of the market read. Live previews, pulled now:

```
GET /crypto/prices/preview   → BTC $80,803 (+1.64% 24h, conf 0.99)   — full: $0.001, up to 25 tokens
GET /crypto/funding/preview  → BTC cross-venue funding, arb spread 1.03 bps,
                               best_long=dydx best_short=okx, signal=LONGS_PAY  — full: $0.004
```

`/crypto/prices` is the second most-requested paid route on the API; `/defi/yields` is the first. That's not a revenue flex — the per-call price is a tenth of a cent — it's a demand signal: the routes agents come back for are the plain market-data reads, delivered keyless.

## Try it right now (no setup)

```
curl https://api.greyridgesignals.ai/defi/yields/preview
curl https://api.greyridgesignals.ai/crypto/prices/preview
curl "https://api.greyridgesignals.ai/defi/yields"   # see the 402 your agent settles
```

Point a generic x402 buyer or an OpenAPI-driven MCP client at `https://api.greyridgesignals.ai` and it will discover, preview and pay for every route from the one catalog file. Start at the [data API for agents](https://api.greyridgesignals.ai/for-agents?ref=greyridge).

---

*Scope & honesty: this is market **data** for an agent to reason over — not financial advice and not a recommendation to enter any pool. APY figures and the stability forecast are DefiLlama estimates, not guarantees; `risk_adjusted_apy` is APY divided by observed volatility, a ranking aid, not a safety rating. DeFi carries loss risk including impermanent loss and smart-contract risk. Data is point-in-time; values move between calls. Grey Ridge Signals Group LLC.*
