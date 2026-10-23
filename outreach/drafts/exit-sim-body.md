Every token-safety API on the market will happily tell your trading agent `sellable: true`. Almost none of them will tell you the number that actually decides whether a trade is a good idea: how much of your money you get back when you try to leave.

"Can I sell it" and "what do I recover when I sell it" are different questions. A token can be perfectly sellable and still hand you back half your position the moment you size up. The honeypot flag is binary. Slippage is a curve. If your agent only reads the flag, it is trading blind on the part that costs real money.

So we built the exit simulation into the paid tier of our Base swap gate. It answers the question the flag skips: **dump $X into this pool right now, walk away with $Y, lose $Z to slippage.**

## The math, in the open

The model is deliberately boring: constant-product (`x*y=k`) over the quote-side reserve, taken as roughly half the measured Uniswap v3 WETH-pool TVL for a balanced position. No oracle magic, no black box. Net recovered on a sell of size `n` into a pool with liquidity `L` is:

```
quoteReserve = L / 2
netRecovered = quoteReserve * n / (quoteReserve + n)
```

It is an approximation and we label it as one: real v3 concentrated liquidity behaves differently right at spot. But it is the honest shape of the exit, and it is computed over the pool depth we actually measured for that token, not a guess.

## What that looks like across three pools

Same four order sizes, three very different pools. Watch what "sellable" hides.

**Thin pool, ~$80k liquidity:**

| Sell | Recover | Lost to slippage | Slippage |
|---|---|---|---|
| $100 | $100 | $0 | 0.25% |
| $1,000 | $976 | $24 | 2.44% |
| $10,000 | $8,000 | $2,000 | 20.0% |
| $50,000 | $22,222 | $27,778 | 55.56% |

**Deep pool, ~$2M liquidity:**

| Sell | Recover | Lost to slippage | Slippage |
|---|---|---|---|
| $100 | $100 | $0 | 0.01% |
| $1,000 | $999 | $1 | 0.1% |
| $10,000 | $9,901 | $99 | 0.99% |
| $50,000 | $47,619 | $2,381 | 4.76% |

**USDC-grade pool, ~$40M liquidity:**

| Sell | Recover | Lost to slippage | Slippage |
|---|---|---|---|
| $50,000 | $49,875 | $125 | 0.25% |

The $50k row tells the whole story. In a deep pool you lose $2,381 and shrug. In an $80k pool the same order recovers $22,222 of your $50,000 and torches the other $27,778. `sellable: true` was correct in both cases. It was also useless.

## Max safe size, not just a warning

Alongside the exit sim we return the largest order that stays under 2% price impact on the measured pool, so your agent has a ceiling to size to instead of a vibe:

```
maxSafeNotional = round(liquidity * 0.02)
```

For the $80k pool that is ~$1,600 per order. For the $2M pool, ~$40,000. Split anything larger. The paid result also breaks price impact into tiers at $100 / $1k / $10k / $50k so you can see where the curve turns against you before you get there.

## Why it is behind a paywall, and why the paywall is 1 cent

The free preview gives you the full honeypot and sellability read at the same depth as the paid call. The exit simulation is kept out of the shared code path on purpose, so the free teaser never leaks it. If you want the sizing and the exit math, you pay once: **0.01 USDC.** No account, no signup, no API key to rotate. Agents settle it inline over x402 at the swap gate for $0.008 a call; a human can unlock a single result from a browser wallet for a penny.

That is the whole pitch. We are not renting you a dashboard. We are selling you the one number your current pre-trade check is lying to you about by omission, for less than the gas you will save by not eating 55% slippage on a pool that was technically sellable the entire time.
