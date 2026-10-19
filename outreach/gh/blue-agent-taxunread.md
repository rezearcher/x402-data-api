Hi — read `apps/web/src/lib/goplus-token.ts` and `pre-trade-check.ts` (nice work on the "unread is never clean" rule). One gap I noticed: when GoPlus doesn't answer for a Base token (free tier, one address per call, 6s timeout), the check falls to `TAX_UNREAD` (line ~280) and the user gets "try a small amount first" with no second opinion.

We run an x402 endpoint that could be that second opinion, independent of GoPlus: an on-chain transfer/sell simulation plus admin-control checks plus Uniswap v3 WETH-pool liquidity vs. trade size.

```
curl 'https://api.greyridgesignals.ai/gate/swap/preview?token=degen&side=buy&notional_usd=500'
# -> {"decision":"go","verdict":"SAFE","risk_score":20,"liquidity_usd":388023,"impact_pct_of_pool":0.13,"flags":["transfers can be paused"],...}   (~1.0s measured just now, 3 calls: 1.08/1.08/0.80s)
```

Paid, any Base ERC-20: `GET /gate/swap?token=<0x…>&side=buy|sell&notional_usd=<n>` — $0.008 USDC per call via x402 (you already ship `@blueagent/x402`). Free preview works for usdc|weth|cbbtc|aero|degen; no key needed.

Honest limits: it does not measure buy/sell tax percentages (the response says so), so it complements GoPlus rather than replacing it. Where it adds signal is (a) GoPlus-unread tokens, and (b) liquidity-vs-notional impact, which your WARN path doesn't currently have.

Suggested wiring: call it only in the `else` branch that currently pushes `TAX_UNREAD`, so you pay only when GoPlus failed. Happy to send a PR for that branch behind a flag if you'd like — tell me which token you'd test first and I'll run it and paste the result here.
