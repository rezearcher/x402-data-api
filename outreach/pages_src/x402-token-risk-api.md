---
title: x402 token risk API, no API key
---
# Pay-per-call token risk API (x402, USDC on Base)

No signup, no key: the server answers HTTP 402 with the price; an x402 client (x402_requests, @x402/fetch) pays USDC on Base and retries. Discovery manifest: [/.well-known/x402](https://x402-data-api.sigrunner.workers.dev/.well-known/x402).

| Route | Price | Returns |
|---|---|---|
| /chain/token-report | $0.01 | SAFE/CAUTION/AVOID + evidence |
| /gate/swap | $0.008 | GO/HOLD/BLOCK |

Sample: curl "https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview?token=0xYourBaseToken"

[Back](index.html)
