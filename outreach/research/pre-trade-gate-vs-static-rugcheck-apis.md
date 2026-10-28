Your trading agent is about to buy a token. The honeypot API you wired in says "clean, not a honeypot." So it buys $5,000,000 of it. The verdict was right and the trade was still a disaster, because that token's whole pool is $130M deep and a $5M market order moves the price against you before the honeypot question ever mattered.

That gap — a token can be perfectly safe to hold and still wrong to buy *at your size* — is why we built `/gate/swap` to answer the question an agent actually has: **is this safe to swap, right now, for the amount I'm about to trade?**

## Static rugcheck vs a gate sized to your trade

Most Base token-safety APIs return a verdict about the *token*: honeypot or not, sellable or not, a risk score. Useful, and we do all of that too. But the verdict is identical whether the agent is buying $200 or $2,000,000 — and those are not the same decision.

`/gate/swap` folds trade size into the answer. It reads the token's Uniswap v3 liquidity and compares it to your notional, then returns one call: **GO**, **HOLD**, or **BLOCK**, with the reason.

Here is the live gate on WETH, the same token, two different trade sizes (run them yourself against the free preview below):

| Trade | Decision | Why | Pool liquidity | Your impact |
|---|---|---|---|---|
| Buy $2,500 WETH | **GO** | tiny vs pool | $129.7M | 0.0% |
| Buy $5,000,000 WETH | **HOLD** | "trade is 3.9% of pool liquidity; split the order" | $129.7M | 3.85% |

Same token, same honeypot result (clean, risk score 0), opposite action. A static rugcheck can't make that call because it never saw your size.

## Where we sit on price

We checked the current Base token-safety field. Per-call prices the vendors publish today land roughly like this (their numbers, not independently verified, and terms change — confirm on each page before wiring one in):

| Service | Per-call | Sizes the trade? |
|---|---|---|
| **Grey Ridge `/gate/swap`** | **$0.008 USDC** | **Yes — GO/HOLD/BLOCK vs your notional** |
| ERC-8004 Token Security | $0.03 USDC | No (honeypot + risk + tax) |
| Apify Base Token Risk Scanner | $0.01 / token | No (pre-trade filter, not an audit) |
| true402 rugcheck | ~$0.01 USDC | No (token report) |
| RGX token_report | $0.005 USDC | No (static report) |

We are not the single cheapest line item — RGX's static report is $0.005. We *are* the only one in that list that returns a decision sized to the trade you're actually making, and we do it at $0.008: cheaper than the $0.01–$0.03 tier, Base-native, no account, no key, paid inline in USDC per call over x402.

## What it does and does not claim

Straight about scope: this is a fast heuristic signal — honeypot/sellability and admin-control checks plus live liquidity-vs-notional sizing — not a guarantee, not an audit, not financial advice. Every response carries that disclaimer. It is built to be the cheap pre-trade reflex an agent fires before every swap, not the one-time deep audit a human runs once.

## Wire it in

Free preview, no payment, any real Base token (3/day/IP) or the demo set `usdc|weth|cbbtc|aero|degen`:

```
GET https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=weth&notional_usd=5000000
GET https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=weth&notional_usd=2500
```

Paid route (HTTP 402 → pay $0.008 in USDC inline → verdict), the one your agent calls on every trade:

```
GET https://x402-data-api.sigrunner.workers.dev/gate/swap?token=0x4200000000000000000000000000000000000006&side=buy&notional_usd=500
```

If you run a Base trading agent, the preview costs nothing and shows you in one request why size belongs in the safety decision. Try your own worst-case notional against a thin token and watch the verdict flip.
