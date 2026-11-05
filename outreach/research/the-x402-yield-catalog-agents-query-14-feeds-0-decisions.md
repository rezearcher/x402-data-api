# The x402 yield catalog agents actually query: 14 feeds, 0 decisions

When people ask "where are the x402 buyers?" the honest answer is not a search engine — it's a handful of agent-facing catalogs an autonomous wallet can query at call time. One of them, `agentic.market`, exposes its whole index over a keyless HTTP API (`GET https://api.agentic.market/v1/services`, `/v1/services/search?q=`). No login, no key. If your agent needs DeFi yields, this is one of the lists it reads.

So we read it, the way an agent would.

## What a buyer sees when it searches "yield"

A query for `q=yield` returns ten services and roughly fourteen yield endpoints. Every one of them is a **raw-data feed**:

| Service | Endpoint (abridged) | What it returns |
|---|---|---|
| Heurist Mesh | `/x402/agents/DefiLlamaAgent/search_yield_pools` | pool list |
| Zapper | `/x402/defi-balances` | balances |
| mcp.yield.xyz | `/x402/yields_get_all` | all pools |
| agent402.tools | `/api/defi-yield-history` | history |
| api.kadec0.xyz | `/v1/yield-pools` | pool list |
| api.marketintelligenceapi.com | `/api/v1/markets/usdc-yield` | market rows |
| api.agentstools.dev | `/rwa/yield` | RWA rows |
| pyd.fi | `/api/agents/yields` | yield rows |

They hand back pools, APYs, TVLs, history. Useful numbers. But an agent that is about to **enter** a position does not need more rows — it needs a decision: *is this APY going to hold, or am I buying the top of a decaying incentive?* Not one of the fourteen endpoints in the catalog answers that question. We checked DefiLlama's own x402 feed too: 15,992 pools, no verdict field.

That is the gap.

## The decision layer, priced for a per-call agent

Grey Ridge serves two routes into exactly this catalog, keyless x402 on Base (USDC, `eip155:8453`):

- **`GET /defi/yields` — $0.001/call** (`amount: "1000"` atomic USDC). The same raw feed everyone else sells, at the bottom of the price band: project, chain, symbol, pool id, APY breakdown, 1d/7d/30d trend, IL risk, TVL, and a DefiLlama stability forecast per pool.
- **`GET /defi/yield-entry-verdict` — $0.01/call** (`amount: "10000"` atomic). The part no one else in the catalog ships: a packaged **`SUSTAINABLE | DECAYING | OUTLIER | AVOID`** verdict for a specific pool, with a risk score and field-cited reasons.

A live sample verdict (free, top-TVL pool) — Lido STETH on Ethereum: `verdict: SUSTAINABLE`, `risk_score: 0`, predicted class `Stable/Up` at 70% probability, APY 2.27%, TVL $23.4B, reason `stable_sustainable` ("Stable-or-up forecast, APY trend intact, adequate liquidity — no decay, outlier or liquidity flags triggered"). Pass `?pool=<poolId from /defi/yields>` to run the verdict on **your** pool free, 3 calls per IP per day, before you ever pay.

## Honest positioning

- **Scope.** This is a quantitative yield-decision tool built on public pool data and a stability forecast — not investment advice, not a guarantee. The verdict is a model output with cited reasons; you can read the reasons and disagree.
- **On price.** The catalog shows most of these yield feeds with no price field populated, the same way ours renders in the auto-ingested tier — so "cheapest" is not the claim. The claim is **category**: raw data vs. a go/no-go entry verdict. Different product, not a cheaper one.
- **Why you may not have seen us.** In `agentic.market` our row sits in the auto-ingested tier (raw chain ids, blank description) alongside every other self-hosted provider; only a few curated brand rows carry a written description. We are found by endpoint URL, not by a marketing blurb. This page is the blurb.

## Call it

```
# free: verdict on the top-TVL pool, no key, no account
curl https://api.greyridgesignals.ai/defi/yield-entry-verdict/preview

# free: verdict on YOUR pool (3/IP/day)
curl "https://api.greyridgesignals.ai/defi/yield-entry-verdict/preview?pool=<poolId>"

# paid: $0.01 x402 on Base — SUSTAINABLE|DECAYING|OUTLIER|AVOID + risk score + reasons
curl "https://api.greyridgesignals.ai/defi/yield-entry-verdict?pool=<poolId>"
```

Fourteen feeds will tell you the APY. One route tells you whether to trust it.
