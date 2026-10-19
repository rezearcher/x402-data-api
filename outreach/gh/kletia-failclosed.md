Hi — I read `apps/api/src/networks/base/security/tokenSecurity.ts`. `checkTokenSecurity` is fail-closed (good): if GoPlus times out (8s) or returns an empty result, the whole route halts with `TOKEN_SECURITY_UNAVAILABLE` / 503. That's the safe default, but it means every GoPlus hiccup or unindexed new token blocks a user's swap.

We run a pay-per-call endpoint that can be a second, GoPlus-independent verifier for exactly that catch path: on-chain transfer/sell simulation + admin-control checks (mint/pause/blacklist/fee-setter/upgradeable proxy) + Uniswap v3 WETH-pool liquidity.

```
curl 'https://api.greyridgesignals.ai/chain/token-report/preview?token=aero'
# -> {"verdict":"SAFE"|"CAUTION"|"AVOID","risk_score":..,"security":{"isHoneypot":false,"sellable":true,"canMint":true,...},"liquidity":{"wethPoolUsd":1896529,...}}
```
Free preview for usdc|weth|cbbtc|aero|degen (~1s); paid for any Base ERC-20: `GET /chain/token-report?token=<0x…>` at $0.01 USDC via x402 (or `/gate/swap`, $0.008, GO/HOLD/BLOCK with notional-vs-liquidity).

Honest limit: it does not return buy/sell tax percentages (the response says "not measured"), so keep your `zeroTax` check where GoPlus answers; use ours only to turn "GoPlus unavailable → 503" into "verified by a second source → proceed or block", and still fail closed if both are down.

Suggested wiring: in the `catch` branch, before throwing UNAVAILABLE, call the endpoint; treat `verdict==="AVOID"` or `isHoneypot`/`!sellable` as RISK and `SAFE` as pass. Tell me a token you'd test and I'll run it and paste the output here, or I can open a PR for that branch.
