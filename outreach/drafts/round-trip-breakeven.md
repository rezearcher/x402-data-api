Most swap interfaces quote you one number before you buy: expected slippage. It looks like a toll you pay once on the way in. It isn't. If you ever plan to sell the position, you pay that toll twice, and the second leg is usually bigger than the first because you are unwinding into the same pool you just pushed around.

We added the missing half to our paid swap gate this week. The free call still gives you the verdict, buy or avoid. The paid call now answers the question a trader actually sizes a thesis against: how far does the price have to move in my favor just to cover the cost of getting in and back out again? We call it the round-trip breakeven, and once you see it you stop trusting the single entry number entirely.

## Why one number lies

Buying a token on a Uniswap WETH pool is a constant-product trade. Spend some dollars, and the tokens you receive are worth slightly less than you paid the instant you fill, because your own order moved the price. That gap is entry slippage. Nobody argues with it.

The part people skip: selling later is the identical trade in reverse, into a pool that is now shallower on the side you want to exit. So the honest cost of a round trip is the entry leg plus the exit leg, and for anything but a tiny order the exit leg dominates. A tool that shows you only the entry number is quoting you half the bill.

Here is the math our gate runs, pulled straight from the engine. It models the quote-side reserve as roughly half the measured pool depth, runs the buy leg, then runs the sell leg on what you would be holding, and sums the two slippage legs into one breakeven percentage. It is an approximation, and we label it as one in the response: it ignores how the pool depth shifts between the two legs. But it is the right shape, and it is honest about its assumptions.

## Two real pools, same order size

I ran two Base tokens through it just now, using the live pool depth our free report measures.

AERO sits in a WETH pool worth about 1.54 million dollars. DEGEN sits in one worth about 262 thousand. Put the same money through each:

| Order | AERO round-trip breakeven | DEGEN round-trip breakeven |
|---|---|---|
| $1,000 | 0.26% | 1.51% |
| $10,000 | 2.53% | 13.26% |
| $50,000 | 11.48% | 43.33% |

Look at the fifty-thousand-dollar row. On AERO you need an 11 percent move just to get your money back out whole. On DEGEN you need the price to nearly double, 43 percent, before a round trip clears the friction. Same dollar amount, same mechanics, wildly different reality, and the only variable is how deep the pool is.

If your mental model was the entry number, you were off by more than half. On the DEGEN fifty-k trade, entry slippage alone reads 27.7 percent. The round trip is 43.3. The exit leg you were not shown is the larger of the two.

## What an agent does with this

The reason this lives behind a paid call is that it is the number an automated trader needs and a human usually eyeballs wrong. A trading agent asks a clean question: is my expected move bigger than my round-trip cost? If the breakeven on a size is 43 percent and your thesis is a 20 percent move, the trade is underwater before it starts, no matter how right you are about direction. The agent should split the order, size down, or skip. That decision wants a single honest number, not a slippage estimate for one leg and a shrug for the other.

The free verdict tells you whether a token is safe to touch. The paid gate, eight-tenths of a cent over x402, tells you what touching it actually costs at your size, both legs, before you commit a dollar. If you only ever look at one of those two numbers, look at the round trip.

Grey Ridge Signals builds pay-per-call market and safety data for Base. Everything above is live: the pool depths come from our free token report, the breakeven math is the same code the paid gate runs.
