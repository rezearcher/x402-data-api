When an AI agent needs DeFi-yield data and has a budget, it doesn't Google. It calls Circle's x402 Discovery API — one keyless GET that returns the whole payable-service catalog — and filters by category and price. Whatever survives that filter is the shortlist. So I pulled the catalog and looked at where the money for yield decisions actually routes, and what it costs.

## The catalog is live, keyless, and queryable

`GET https://api.circle.com/v2/x402/discovery/resources` returned HTTP 200, 144,716 bytes, **2,781 total listings** — no API key, no account, no auth. Each row carries the `accepts[]` block an agent pays against (scheme, network, asset, `payTo`, `amount`) plus provider metadata. The filters agents use are first-class: `category`, `maxUsdPrice`, `network`, `type`, `query`. This is the lookup a funded dev-agent runs *at decision time*.

Filtered to `category=FINANCIAL_ANALYSIS`: **460 listings**. The sub-penny band isn't empty — 119 listings price at or below $0.01 — but look at *what* they serve. 91 of those are BlockRun.AI, and they're prediction-market feeds (Kalshi and Polymarket markets, orderbooks, trades). For DeFi yields specifically, the dedicated provider in the category is **vaults.fyi**. So I priced them, endpoint by endpoint, live.

## vaults.fyi gates the decision layer; the raw lists are cheap

| vaults.fyi endpoint | Price/call | What it returns |
|---|---|---|
| `/v2/vaults` | $0.002 | List of vaults + summary metrics |
| `/v2/assets`, `/v2/networks`, `/v2/tags` | $0.002 | Reference lists |
| `/v2/portfolio/best-vault/{address}` | $0.004 | Single best vault for a wallet |
| `/v2/portfolio/idle-assets/{address}` | $0.01 | Idle assets that could be deployed |
| `/v2/portfolio/best-deposit-options/{address}` | **$0.202** | Ranked deposit options |
| `/v2/detailed-vaults` | **$0.302** | Full detail incl. historical APY + risk ratings |

The pattern is clear and sensible: the raw lists are a fifth of a cent, and the *decision* — ranked options, risk-rated detail — is where the price jumps to **$0.20–$0.30 a call**.

## Where a $0.01 decision layer lands

Grey Ridge's DeFi routes, priced live this hour off their own 402 challenges:

- `/defi/yields` — **$0.001** (atomic 1000): the raw pool feed, DefiLlama-sourced + ranked.
- `/defi/yield-entry-verdict` — **$0.01** (atomic 10000): the decision call — `SUSTAINABLE | DECAYING | OUTLIER | AVOID` on a specific pool, with a risk score and an APY-stability forecast.

So on the part that costs money in this category — the decision — the comparison is `best-deposit-options` at **$0.202** versus a per-pool entry verdict at **$0.01**: roughly **20× cheaper on the layer agents actually pay a premium for**. And the raw yield list sits at $0.001, matching the floor of the whole category. An agent re-checking whether an open LP position is still worth holding as its APY decays can poll an entry verdict all day for the price of one of vaults.fyi's detailed-vault calls.

That's the honest wedge: not "better data than vaults.fyi" — they're a strong, specialized source. It's that the *decision layer is priced for polling* instead of priced as a premium. DefiLlama's `yields.llama.fi/pools` is free and keyless (15,993 pools) but ships no verdict; vaults.fyi's ranked/detailed decision calls run 20–30× our verdict price ($0.202–$0.302 vs $0.01).

## The honest part

Being *queryable* in Circle's catalog is necessary, not sufficient. x402 settlement volume has been in a demand-winter — a listing is a shot at inbound agent demand, not a guarantee of it. This is market-structure analysis measured live, not a claim that Grey Ridge is listed in the catalog today; entry is a manual intake with a payout-wallet sanctions screen. And the verdict is a model-derived forecast — decision support, not advice or a guarantee. The routes are real, the prices on both sides are real, and the $0.20-vs-$0.01 gap on the decision layer is real.

*All figures pulled live from `api.circle.com/v2/x402/discovery/resources`, `api.vaults.fyi` listing metadata in that catalog, and the Grey Ridge 402 challenges on 2026-11-04. Catalog contents and prices change; re-run the query to re-verify.*
