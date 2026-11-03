If your agent trades perps on Base, the funding rate is half the trade. It decides which side pays, where the carry is cheapest, and whether a "high APY" long is really just you paying the funding. The problem is getting the number. The venues that matter for a perp funding comparison — Hyperliquid, OKX, dYdX, Binance, Bybit — do not hand it over cleanly from a cloud host, and most Python data SDKs do not carry funding at all.

`greyridge-x402-tools` is now on PyPI, and the funding feed is two lines:

```python
import greyridge_x402 as g
g.funding_rates(symbol="BTC")
```

No API key. No account. The call above ran just now in a clean virtualenv with nothing but `pip install greyridge-x402-tools` and returned live data.

## What one call returns

The five venues come back already joined, with the cross-venue spread and the paying side computed for you. Real sample pulled today for BTC:

```
venue          per-interval     annualized
hyperliquid      0.00001250          1.37%
okx              0.00010000         10.95%
dydx             0.00001650          1.81%
binance          0.00010000         10.95%
bybit            0.00008906          9.75%

spread: 0.88 bps   signal: LONGS_PAY
best long: hyperliquid    best short: okx
```

`signal: LONGS_PAY` means longs are paying shorts right now. If you were about to open a long into that, the funding is working against you; the cheapest place to carry the long is Hyperliquid, and the richest place to be short is OKX. That is the whole decision, in one field, without you fetching five endpoints and doing the arithmetic.

## The part that is actually hard: two of those venues won't answer you

This is not hypothetical. Hitting the venues directly from a datacenter IP — which is where agents run — fails for the two biggest books. Run from this host, right now:

```
GET https://fapi.binance.com/fapi/v1/premiumIndex   ->  HTTP 451
GET https://api.bybit.com/v5/market/tickers         ->  HTTP 403
```

Binance geo-restricts (451) and Bybit blocks (403) requests from most cloud ranges. So the CCXT route — `pip install ccxt`, instantiate each exchange, call `fetch_funding_rate` per venue, handle each one's rate limits, then compute the spread yourself — quietly loses Binance and Bybit the moment you deploy to AWS, GCP, or a Worker. The feed above returns both anyway, because the backend bridges them through a non-geoblocked source rather than calling the blocked endpoints directly. You get the venues you cannot reach from your own server.

## Keyless preview vs the paid full feed

The two-line call above is the free preview. It is real data, but it is a one-coin sample and it ignores the `symbol`/`project` filter — it returns the top row regardless of what you ask for. For the full, filtered set across all tracked coins, the same function settles a micropayment inline:

```python
g.funding_rates(symbol="BTC", paid=True, private_key=PK)   # [pay] extra + a funded Base wallet
```

That is one x402 call: USDC on Base (`eip155:8453`), `0x833589…2913`, amount `4000` — **$0.004** per full pull, no subscription, no key. The `[pay]` extra (`pip install "greyridge-x402-tools[pay]"`) adds the wallet signing; the base install stays dependency-light (just `requests`) so the preview path has no crypto dependencies at all.

The same two functions are also there for the other two data feeds: `g.defi_yields(project="aave")` and `g.token_prices(["bitcoin"])`, same keyless-preview-then-paid-full shape, and there is a `greyridge-data` CLI if you want it from the shell. Full machine-readable catalogue: `https://api.greyridgesignals.ai/.well-known/x402`.

## Where it sits against the alternatives

CoinGecko's Python client (`pycoingecko`) is the default for spot prices, but it does not carry perp funding, and production use needs a demo/Pro API key. CCXT does carry funding, but it is per-exchange plumbing you assemble and maintain, and it inherits each venue's geoblock — which is exactly where the two biggest books drop out from a server. This feed is narrower on purpose: five perp venues, pre-joined, with the spread and paying side computed, reachable from a datacenter, installable with one `pip install` and no signup.

## Scope, honestly

Funding rates are a point-in-time read of what each venue is advertising, not a prediction of the next funding print. The free preview is a single-row sample and does not honour the `symbol`/`project` filter — only the paid call does. Annualized figures assume the standard 8-hour funding interval (3× daily) and move with the live rate. This is market data to inform a decision; it is not trading advice and not a guarantee of a venue's settlement or availability at the moment you trade.
