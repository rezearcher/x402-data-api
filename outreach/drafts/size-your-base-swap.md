Every trader who has ever eaten a bad fill knows the feeling: you send a market order into a thin pool, and the price you actually get is nothing like the price you saw. The order moved the market against you before it filled. On Base, where a lot of pairs sit in pools holding a few hundred thousand dollars of liquidity, this is not an edge case. It is the default outcome for any order that is large relative to the pool.

The honeypot question gets all the attention. "Can I sell this token?" is the first thing a safety check answers, and it should be. But a token can be perfectly sellable and still be a terrible trade right now, because the pool is too shallow to absorb your size without a painful slippage tax. That second question, "how big can I go before I move the price?", is the one most pre-trade checks skip. It is the one our swap gate answers.

## Price impact is just your order divided by the pool

The model is deliberately boring. Price impact, as a percentage of pool liquidity, is your trade notional divided by the measured Uniswap v3 WETH-pool liquidity for that token:

    price_impact_pct = notional_usd / pool_liquidity_usd

Boring is the point. There is no magic coefficient to argue about and no hidden fudge factor. It is a linear relationship: double your order, double your impact. The max safe order is the one that keeps you under 2% of pool depth, which is a flat 2% of the measured liquidity. Anything bigger should be split into multiple orders or sent through an aggregator that routes across venues.

## What that looks like across three pools

Here is the same four orders ($100, $1,000, $10,000, $50,000) run against a thin memecoin pool, a mid-cap pool, and a deep pair. The max-safe figure is 2% of each pool.

**Thin memecoin pool, $80,000 liquidity** (max safe: $1,600)

| Order | Price impact |
|------:|-------------:|
| $100 | 0.12% |
| $1,000 | 1.25% |
| $10,000 | 12.5% |
| $50,000 | 62.5% |

A $10,000 order into an $80k pool moves the price 12.5% before you are filled. A $50k order moves it more than 60%. You are not trading at that point, you are donating.

**Mid-cap pool, $2,000,000 liquidity** (max safe: $40,000)

| Order | Price impact |
|------:|-------------:|
| $100 | 0.00% |
| $1,000 | 0.05% |
| $10,000 | 0.5% |
| $50,000 | 2.5% |

**Deep pair, $40,000,000 liquidity** (max safe: $800,000)

| Order | Price impact |
|------:|-------------:|
| $100 | 0.00% |
| $1,000 | 0.00% |
| $10,000 | 0.02% |
| $50,000 | 0.12% |

Same four order sizes, three completely different verdicts. $50,000 is a 2.5% nick in the mid-cap pool and a rounding error in the deep pair, but it is a 62.5% self-inflicted wound in the thin one. The order size that is safe in one pool is a disaster in another, and the only thing that tells them apart is the measured liquidity.

## A live one, right now

We pulled DEGEN through the free preview while writing this. The WETH-pool liquidity measured $265,437. A $10,000 order comes back at 3.77% of pool, with the gate's own reason attached: *trade is 3.8% of pool liquidity; split the order.* That is a real token, a real pool, a real number from the live endpoint, not a worked example.

Try it yourself, no account and no key:

    curl "https://api.greyridgesignals.ai/gate/swap/preview?token=degen&notional_usd=10000"

Swap in any Base ERC-20 address. The free preview gives you the decision (GO / HOLD / BLOCK), the honeypot and sellability result, the measured pool liquidity, and your trade's impact as a percent of that pool. Three real tokens a day per IP are free.

## What the paid call adds

The $0.008 gate call, and the $0.01 browser-wallet unlock that mirrors it, add the sizing math on top of the free verdict: the max-safe notional for the pool, the full price-impact table across order sizes, and an exit simulation that tells you how much USD you actually walk away with if you sell a given size into the pool after slippage. One call, one decision, sized to your trade, paid inline in USDC. No signup, no monthly minimum, no key to rotate.

The honeypot check keeps you out of the tokens you can never sell. The sizing check keeps you from rugging yourself on the ones you can.
