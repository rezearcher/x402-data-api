# The multi-venue funding "arb" that isn't: screening thin-book venues before you trade

Pull perp funding rates from six venues, take the highest minus the lowest, and you have
a cross-exchange funding spread. Easy. The trap is that the *extreme leg* — the venue with
the juiciest rate — is often the one with the thinnest order book. You can't fill size there,
so the spread you're staring at is a mirage. The number is real; the trade is not.

`GET /crypto/funding` returns an **OI-weighted arb verdict**: it screens a venue out of the
best-long / best-short calculation when that venue's open interest is *known and below
$1,000,000* (`THIN_OI_FLOOR_USD`), so the long/short pair it hands back is one you could
actually execute — not the artifact of a dead market. Keyless x402 on Base, **$0.004/call**,
no API key and no signup.

## What the feed returns (live BTC, 6 venues)

| venue | funding (8h) | open interest |
|-------|--------------|---------------|
| hyperliquid | 0.00125% | $3.30B |
| okx | 0.00920% | $2.70B |
| dydx | 0.00329% | $17.7M |
| binance | 0.01000% | null (geo-blocked from our edge — **kept**, not dropped) |
| bybit | 0.00434% | null (geo-blocked from our edge — **kept**, not dropped) |
| gate | 0.01000% | $2.28B |

```
funding_spread_bps : 0.88
best_long_venue    : hyperliquid
best_short_venue   : binance
excluded_thin_venues: []
oi_weighted        : true
```

For BTC, `excluded_thin_venues` is empty — every venue clears the $1,000,000 floor
(dYdX, the smallest at $17.7M, is still well above it). That's the honest
answer: **BTC is liquid everywhere, so there's nothing to screen.** The screen earns its
keep on thinner alts, where a single small venue posts an off-market rate on an order book
you can't trade against — that venue gets dropped from the min/max, and the spread collapses
to what's actually fillable.

## The rule, stated plainly

- A venue is excluded from best-long / best-short **only** when its OI is **known and < $1,000,000**.
- If a venue's OI is **unknown** (Binance and Bybit read `null` above — they're geo-blocked
  from our Cloudflare edge), it is **kept, not dropped**. We never silently discard a venue
  just because *we* couldn't measure it from one vantage point. Degrade-open, not fail-closed.
- With fewer than two survivors the feed falls back to the raw set and flips `oi_weighted:false`,
  so you always know whether the screen was applied.

This is a data feed, not trade advice. The verdict is an **executability screen** — it does not
model fees, latency, or slippage, and it is not a guarantee of fill. The signal is *direction*
(which side pays), not a recommendation.

## Where this sits next to the alternatives

The idea of filtering out un-fillable opportunities isn't ours alone, and it's worth being
straight about that:

- **[Octav's perp dashboard](https://octav.fi/blog/perp-funding-rates-dashboard.md)** (free, 9 DEXs)
  warns exactly about this — a symbol with little open interest on a small venue drifts far from
  the majority. It validates the thesis, but it's a human dashboard, not an API an agent can call.
- **[Funding Radar](https://apify.com/opaline_midge/funding-radar)** (Apify) ranks by net APR
  after fees and can drop pairs with no OI data — the closest peer. The difference is packaging:
  it's an Apify actor (account + per-run billing); ours is a keyless x402 micro-payment on Base,
  and we **keep** unknown-OI venues rather than dropping them.
- **[funding-mcp](https://glama.ai/mcp/servers/namixai/funding-mcp)** ranks spread across 20+
  venues but its own notes say it excludes fees, latency, and execution timing.
- **CoinGlass** has the deepest coverage and history and a polished dashboard — the reference
  for a human analyst. Its API needs a key, and the depth comes at a flat subscription; it isn't
  a cold, keyless pay-per-call an autonomous agent can hit without onboarding.

Our lane is narrow and deliberate: an **agent-native, keyless, pay-per-call** funding feed that
returns the executability screen *inline as structured fields* (`best_long_venue`,
`best_short_venue`, `funding_spread_bps`, `open_interest_usd`, `excluded_thin_venues`,
`oi_weighted`) so the agent acts on the verdict directly, with nothing to post-process.

## The math on pay-per-call

At **$0.004** per call, polling one symbol every 8h (when funding actually updates) is
~90 calls/month = **$0.36/mo**; ten symbols ≈ **$3.60/mo**.
A flat API tier only wins once you're making real volume: you'd need **7,250 calls/month**
to beat an illustrative \$29/mo plan, or **74,750 calls/month** to beat a \$299/mo one.
Below that, you pay cents for exactly the calls you make and nothing when your agent is idle.

## Call it

```bash
# free top-1 sample, no key:
curl "https://api.greyridgesignals.ai/crypto/funding/preview?symbol=BTC"

# full ranked feed (6 venues + OI-weighted verdict), x402 $0.004 on Base:
#   GET https://api.greyridgesignals.ai/crypto/funding?limit=20
```

Payment: 4000 units of USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) on Base
(`eip155:8453`) — one x402 settlement, no account. Also installable as the Python function
`funding_rates()` in [`greyridge-x402-tools`](https://pypi.org/project/greyridge-x402-tools/)
(`pip install greyridge-x402-tools`).
