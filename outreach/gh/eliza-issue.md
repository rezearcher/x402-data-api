Hi, for ElizaOS agents that make Base payments or swaps: a free pre-trade token-safety check you can call without a wallet or key.

```bash
curl -s "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=weth"
# {"decision":"go|hold|block","verdict":"SAFE|CAUTION|AVOID","risk_score":..,"flags":[..]}
```
Any Base ERC-20 works (3/day per IP). The same route over x402 is $0.008 USDC on Base for unlimited use. OpenAPI: https://x402-data-api.sigrunner.workers.dev/openapi.json. Happy to PR it in as an action if useful. Close freely if not.
