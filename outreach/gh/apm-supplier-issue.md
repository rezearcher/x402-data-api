Hi — Grey Ridge Signals here. We run an x402 token-risk supplier that fits APM's `token_risk` category and is cheaper than the $0.011–$0.021 customer range, which should give you more margin.

- `GET https://x402-data-api.sigrunner.workers.dev/chain/token-security?address=<erc20>` — $0.009 USDC, Base mainnet, exact-price 402 (v2 `payment-required` header). Proxy/upgradeability, owner privileges, mint/pause/blacklist, honeypot sim, holder concentration.
- `GET /chain/token-report?address=<erc20>` — $0.02, verdict + risk score.
- `GET /gate/swap?...` — $0.008 swap pre-trade gate.
- Listed in the CDP Bazaar. OpenAPI: https://x402-data-api.sigrunner.workers.dev/openapi.json

Free no-payment sample for your validation probe (any Base token, 3/IP/day): `https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=<0x...>` and `/chain/token-report/preview?token=<0x...>`.

Happy to adjust the response shape to whatever your validator expects. Contact: contact@greyridgesignals.ai
