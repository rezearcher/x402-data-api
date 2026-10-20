Hi — x402-cow-gateway is a neat fit for a pre-trade safety field, so a concrete suggestion rather than a generic pitch.

An agent that buys a quote from `quote-plus` ($0.008) is about to swap into a `buyToken` it may never have vetted. CoW's quote tells it the price but not whether the token can be sold back. We run a Base pay-per-call endpoint that answers exactly that:

```
curl "https://api.greyridgesignals.ai/chain/token-report/preview?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"
# -> {"token_meta":{"symbol":"DEGEN"},"verdict":"SAFE","risk_score":20,"security":{"isHoneypot":false,"sellable":true,...},"liquidity":{"wethPoolUsd":386409,...}}
```

The preview is free and needs no wallet. The paid route (`/chain/token-report`, x402 USDC on Base, $0.008) returns the same shape with the full report. It checks honeypot/sellability by transfer simulation, owner/mint/pause/blacklist flags and Uniswap v3 liquidity, with RPC failover. Limit up front: it does not measure buy/sell tax percentages.

Two ways to use it, whichever you prefer:
1. Add an optional `safety: true` flag to `quote-plus` that calls our `/chain/token-report` for the `buyToken` and attaches `verdict` + `risk_score` to the response. You are already an x402 buyer upstream, so it is one more paid hop and you can mark it up like the cow.fi one.
2. List us in the README/skill as the recommended "check before you swap" companion.

Happy to write the PR for option 1 if you tell me which package (`packages/api`?) and conventions you want. Which tokens would your users most likely check first?
