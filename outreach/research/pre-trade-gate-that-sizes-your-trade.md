# Your honeypot check says SAFE. The trade can still be too big.

A Base trading agent checks a token, gets "safe," and buys. The token is genuinely clean: not a honeypot, ownership renounced, no sell tax. The agent still loses money on the fill, because the buy was a large slice of a thin pool. It moved the price against itself and became the exit liquidity for everyone already in.

That second failure is the one almost every token-safety API skips. They answer "is this token a scam?" They do not answer "given the size of *this* trade, will the pool absorb it?"

## The live proof

Here is our gate on Wrapped Ether, one of the safest tokens on Base, with an intentionally oversized order:

```
GET /gate/swap/preview?token=0x4200...0006&side=buy&notionalUsd=5000000

{
  "decision": "hold",
  "reason": "trade is 6.8% of pool liquidity; split the order",
  "verdict": "SAFE",
  "risk_score": 0,
  "liquidity_usd": 73693968,
  "impact_pct_of_pool": 6.78,
  "disclaimer": "Heuristic risk signal, not financial advice or a guarantee."
}
```

The token is SAFE and the risk score is 0. The decision is still HOLD, because a five-million-dollar buy is 6.78% of the live WETH pool. A reputation-only check returns "safe" here and lets the agent take the slippage. Ours returns HOLD and tells it to split the order. Run that URL yourself, it is a free preview.

## Reputation is not execution safety

The x402 token-safety services on Base are real and some are priced below us. Third-party directory listings show klymax402 Token Safety at roughly $0.003 to $0.008 a call returning isHoneypot, buyTax, sellTax, holderCount and a riskScore, and true402 around $0.01 for a honeypot report. GoPlus runs a large open token-security API. These are useful and we are not the cheapest.

Look at what every one of those field lists has in common: they are all properties of the token. None of them take your notional trade size. A token can pass all of them and still be a bad trade for your agent right now, because "safe to hold" and "safe to buy five million dollars of into this pool" are different questions. The pool depth and your order size decide the second one, and the token's contract cannot tell you.

## What the gate does differently

One GET request. Pass the token, the side, and `notional_usd`, and get a one-word GO / HOLD / BLOCK with a reason. In that single call it combines honeypot and sellability simulation, admin-control checks, and Uniswap v3 WETH-pool liquidity measured against your trade size for a price-impact guard. It is Base-native and pay-per-call over x402: the live quote is $0.008 in USDC, which is competitive with the other x402 safety routes rather than cheaper than all of them. The difference you are paying for is the sizing dimension, not the price.

That is the piece a trading agent actually needs at the moment of decision. Not a report it reads later. A GO/HOLD/BLOCK it can branch on, before it signs.

## What this is and is not

This is a heuristic risk signal, not financial advice and not a guarantee. A "SAFE" verdict means no known honeypot pattern matched and the pool is deep enough to trade, not that the trade will be profitable and not that the token is risk-free. It does not replace your own slippage limits or position sizing. The price-impact figure is measured against the live WETH pool at scan time and markets move. Use it as one gate in your pre-trade path, wired to actually block, not as a promise.

## Wire it in

Point your agent's pre-trade step at the gate, branch on the decision, and let HOLD and BLOCK stop a fill before it costs you. Try the free preview on any Base token above, then see the per-call pricing.

- Try it live (free preview): [gate/swap preview on WETH, $5M buy](https://api.greyridgesignals.ai/gate/swap/preview?token=0x4200000000000000000000000000000000000006&side=buy&notionalUsd=5000000)
- Per-call pricing: [api.greyridgesignals.ai/pricing](https://api.greyridgesignals.ai/pricing)
