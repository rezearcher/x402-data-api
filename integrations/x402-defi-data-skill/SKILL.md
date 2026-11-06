---
name: x402-defi-data
description: Give a DeFi or trading agent live, decision-tagged market data it can pay for inline with x402 (USDC on Base). DeFi pool yields, each carrying a SUSTAINABLE, DECAYING, OUTLIER, or AVOID verdict and a risk score; cross-venue perp funding rates across six venues with per-venue open interest and an OI-weighted carry and funding-rate-arbitrage verdict; and token prices with a confidence and a short provenance trajectory. Keyless free previews and a three-calls-per-day full-output trial need no wallet; the paid call settles per request in USDC on Base with no API key or account. Use when an agent must decide which yield to enter, which venue pays the best funding rate, or what a token is worth, and wants the answer already scored rather than a raw feed it has to judge itself. Keywords: defi yields, funding rates, funding rate arbitrage, token prices, APY, perp funding, carry trade.
license: MIT
---

# Decision-tagged DeFi & trading data an agent can pay for by the call

Most market feeds hand an agent a wall of numbers and leave the judgment to it:
is this 40% APY real yield or a decaying emission that collapses next week? Is
this funding spread a carry trade or noise inside one thin venue? This skill
calls a hosted x402 API that returns the data **already scored** — every yield
row carries a verdict, every funding set carries an arb verdict — so the agent
acts on a decision, not a feed.

No API key, no account, no SDK required. Free previews and a small daily trial
are keyless; the full paid call settles inline in USDC on Base via x402.

## The four routes

| Route | Price | What it returns |
|-------|-------|-----------------|
| `GET /defi/yields` | $0.001 | DeFi pool yields, each row tagged `verdict` (`SUSTAINABLE` / `DECAYING` / `OUTLIER` / `AVOID`) + `risk_score`, risk-adjusted APY, and a provenance trajectory (how the APY has actually moved since first tracked). Filter with `?chain=arbitrum` etc. Returns each pool's DefiLlama `pool` id — feed it to the next route. |
| `GET /defi/yield-entry-verdict?pool=<id>` | $0.01 | The deep go/no-go for **one** pool you're about to enter: a packaged `SUSTAINABLE` / `DECAYING` / `OUTLIER` / `AVOID` verdict + `0-100 risk_score`, field-cited `reasons`, a `predicted` class with probability, risk-adjusted APY, IL risk, and σ. This is the "should I put capital in *this* LP" answer, not a list to re-judge. |
| `GET /crypto/funding` | $0.004 | Perp funding across Hyperliquid, OKX, dYdX, Binance, Bybit, Gate — with `open_interest_usd` per venue, an **OI-weighted** `funding_spread_bps`, `best_long_venue` / `best_short_venue`, and a `signal` (`LONGS_PAY` / `SHORTS_PAY`). Thin venues are excluded from the arb verdict, not silently averaged in. |
| `GET /crypto/prices` | $0.001 | Token spot prices with a `confidence`, 24h change, and a `provenance` block (tracked-since, tick count, and the recent value trajectory) so a price is auditable, not a bare number. |

**The two-step yield decision:** `GET /defi/yields` lists the candidate pools
(each tagged, each with its `pool` id); `GET /defi/yield-entry-verdict?pool=<id>`
returns the full entry verdict for the one you pick. List cheap ($0.001), then
commit the deep check ($0.01) only on the pool you're actually sizing into.

Base host: `https://x402-data-api.sigrunner.workers.dev`
(All USDC-on-Base, `eip155:8453`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.)

## Try it with no wallet first

Every route has a keyless preview and a keyless **3-calls-per-day full-output
trial** (pass the real query param and you get the complete paid result up to
the daily cap, then it degrades to a teaser + the paid URL):

```bash
# Free preview — top rows, fully tagged, no payment
curl -s https://x402-data-api.sigrunner.workers.dev/defi/yields/preview

# Keyless trial — full filtered result, 3x/IP/day
curl -s "https://x402-data-api.sigrunner.workers.dev/defi/yields/preview?chain=arbitrum"

# Deep entry verdict for ONE pool — pass a pool id from /defi/yields (3x/IP/day free)
curl -s "https://x402-data-api.sigrunner.workers.dev/defi/yield-entry-verdict/preview?pool=747c1d2a-c668-4682-b9f9-296708a3dd90"

curl -s https://x402-data-api.sigrunner.workers.dev/crypto/funding/preview
curl -s https://x402-data-api.sigrunner.workers.dev/crypto/prices/preview
```

A real preview row already carries the edge, e.g. a Lido STETH pool comes back
with `"verdict":"SUSTAINABLE","risk_score":0` alongside the APY and its
trajectory; a decaying Arbitrum pool comes back `"verdict":"DECAYING"`. The
entry-verdict preview adds the `reasons` (field-cited) and a `predicted` class,
e.g. `{"verdict":"SUSTAINABLE","risk_score":0,"predicted":{"class":"Stable/Up","probability":70}}`.

## Pay per call with x402 (no key, no account)

Hit the route without payment and it answers `HTTP 402` with an x402 challenge:

```json
{ "accepts": [{
  "scheme": "exact",
  "network": "eip155:8453",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "maxAmountRequired": "1000",
  "resource": "https://x402-data-api.sigrunner.workers.dev/defi/yields"
}] }
```

An agent with an x402-capable fetch wrapper (e.g. `@x402/fetch`, or the
`x402-requests` Python client) settles it automatically — same as any x402
service:

```ts
import { wrapFetchWithPayment } from "@x402/fetch";
const pay = wrapFetchWithPayment(fetch, walletClient);        // your Base wallet
const res = await pay("https://x402-data-api.sigrunner.workers.dev/crypto/funding");
const funding = await res.json();  // full result, settled inline for $0.004 USDC
```

## Python agents: one `pip install`

The same routes are exposed as keyless Python functions (free preview / trial
built in, paid mode when a wallet is configured), plus LangChain and CrewAI
tool wrappers and a `greyridge-data` CLI:

```bash
pip install greyridge-x402-tools
```

```python
from greyridge_x402_tools import defi_yields, funding_rates, get_price, yield_entry_verdict

rows   = defi_yields(chain="arbitrum")   # each row tagged SUSTAINABLE/DECAYING/OUTLIER/AVOID
fund   = funding_rates()                 # OI-weighted cross-venue funding + arb verdict
price  = get_price("ethereum")           # spot + confidence + provenance
pick   = yield_entry_verdict(pool="<pool-id>")  # SUSTAINABLE|DECAYING|OUTLIER|AVOID for YOUR pool
```

```bash
greyridge-data yield-verdict --pool <pool-id>
```

## Why scored data instead of a raw feed

A raw yields feed (DeFiLlama) or a raw price feed (CoinGecko) makes the agent
re-derive risk every call. Here the judgment is done at the source and travels
with the row:

- **Yields** — `verdict` separates real, persistent yield from emission decay
  and outliers, so an agent entering an LP position doesn't chase an APY that's
  already collapsing. The `provenance` trajectory shows how the APY actually
  moved, not just the current snapshot.
- **Funding** — the arb verdict is **OI-weighted** and excludes known-thin
  venues, so a spread that only exists on an illiquid book isn't mistaken for a
  tradable carry. `best_long_venue` / `best_short_venue` name the legs directly.
- **Prices** — every price carries a `confidence` and an auditable trajectory,
  so a stale or thin quote is visible rather than trusted blindly.

"Scored" is a decision aid, not investment advice — the agent still owns the
trade. But it starts from a verdict, not a spreadsheet.
