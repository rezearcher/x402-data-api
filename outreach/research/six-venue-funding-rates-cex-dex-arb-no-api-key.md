# Six-venue funding rates, CEX↔DEX arb spread, no API key

If you run a Base trading agent that cares about perpetual funding, you have two annoying options today: scrape each exchange yourself and normalize the formats, or buy a data subscription that gates the API behind a key and a monthly floor. There is now a third option that fits how an agent actually spends money — one HTTP call, pay-per-use, no account.

## What the endpoint returns

`GET https://api.greyridgesignals.ai/crypto/funding?limit=20` returns the top coins by 24h notional volume, and for each one:

- Per-venue funding across **6 venues** — 4 CeFi (Binance, Bybit, OKX, Gate) + 2 on-chain perp DEXs (Hyperliquid, dYdX).
- `funding_spread_bps` — the cross-venue spread in basis points.
- `best_long_venue` / `best_short_venue` — cheapest place to pay funding vs richest place to receive it.
- `premium` / basis, annualized rate per venue, and a `LONGS_PAY` / `SHORTS_PAY` / `NEUTRAL` signal.
- `next_funding_ts`, mark/oracle price, open interest, 24h volume.

A live BTC row right now:

```json
{
  "coin": "BTC",
  "funding": { "hyperliquid": 1.25e-05, "okx": 9.37e-05, "dydx": 4.58e-05,
               "binance": 0.0001, "bybit": 4.11e-05, "gate": 0.0001 },
  "funding_spread_bps": 0.88,
  "best_long_venue": "hyperliquid",
  "best_short_venue": "binance",
  "signal": "LONGS_PAY"
}
```

The `best_long_venue: hyperliquid` / `best_short_venue: binance` line is the point. That is a **CEX↔DEX arbitrage verdict** computed for you: the cheapest venue to hold the long leg (a DEX) against the richest venue to hold the short leg (a CEX), in one field. Most funding feeds hand you a table of numbers and leave the cross-venue comparison — the part that actually decides a carry trade — to you.

## Two lines of Python

```python
import requests
rows = requests.get("https://api.greyridgesignals.ai/crypto/funding?limit=20",
                    headers={"X-PAYMENT": pay_header}).json()["data"]
# each row already has best_long_venue / best_short_venue / funding_spread_bps
```

Payment is [x402](https://www.x402.org/) on Base: the first call returns HTTP 402 with the price, your wallet signs a USDC transfer, you retry with the `X-PAYMENT` header. No key to provision, no dashboard, no subscription. A free top-1 sample lives at `/crypto/funding/preview` so you can see the shape before you pay a cent.

## Honest cost comparison

The dominant funding-rate aggregator is [CoinGlass](https://www.coinglass.com/pricing). Its web dashboard is free, but the **API** is not: there is no free API tier, the cheapest plan is $29/mo and is personal-use only, and embedding the data in a commercial product starts at the Standard plan ($299/mo). Every API request needs a `CG-API-KEY` header — no key, 401. (Prices per [ComparEdge](https://comparedge.com/tools/coinglass/pricing), verified July 2026; confirm at coinglass.com.)

Here is the math at **$0.004 per call** (the live x402 price — `amount: 4000`, USDC 6 decimals):

| Your agent does… | Pay-per-call (this feed) | CoinGlass API minimum | 
|---|---|---|
| 10 funding checks/day | **$1.20/mo** | $29/mo (personal only) |
| 50 funding checks/day | **$6.00/mo** | $29/mo (personal only) |
| 200 funding checks/day | **$24.00/mo** | $29/mo (personal only) |
| commercial embedding | pay-per-call, any volume | $299/mo (Standard) |

You would have to make **7,250 calls a month** before CoinGlass's cheapest tier wins on raw price — and that tier forbids commercial use. For the commercial-use tier the break-even is **74,750 calls/month**. A typical agent checking funding a few dozen times a day is paying single-digit dollars a month here versus a $29–$299 floor, with zero signup friction.

## Where CoinGlass is still ahead — and where this isn't

CoinGlass covers far more venues, longer history, liquidations, and options data. If you need deep historical funding or a dozen exchanges, buy the subscription. This feed is deliberately narrow: **live** cross-venue funding on 6 high-liquidity venues with the CEX↔DEX arb comparison already computed, priced so an agent can call it on demand without a human provisioning a key. It is a data feed, not trading advice — the `signal` field is a description of current funding direction, not a recommendation to enter a position.

## Try it

- Free sample (no payment): `GET /crypto/funding/preview`
- Full feed: `GET /crypto/funding?limit=20` ($0.004 x402, Base USDC)
- Same data as a keyless Python package: `pip install greyridge-x402-tools` → `funding_rates()`

One call. Six venues. The arb verdict done for you. No key.
