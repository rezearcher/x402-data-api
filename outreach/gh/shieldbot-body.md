ShieldBot already says "Unknown instead of Safe when evidence is missing", which is the right posture. For Base tokens, Grey Ridge offers one more independent evidence source: a simulation-based pay-per-call check (honeypot sell-simulation via on-chain `eth_call`, transfer tax measured with `eth_simulateV1`, liquidity depth, admin-control flags) returning one go/hold/block decision with the flags behind it.

```bash
B=https://x402-data-api.sigrunner.workers.dev
# free preview, no wallet, same response shape as paid
curl -s "$B/gate/swap/preview?token=weth"
curl -s "$B/chain/token-report/preview?token=usdc"
```

Paid route is `/gate/swap?token=<addr>&side=buy&notional_usd=100` at $0.008 USDC (x402, Base). Base only today. Measured on our own probe (240 samples, ~4h): 100% success, token-report p50 ~1.1s / p95 ~1.7s. That is a short window, not an SLA: https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

Happy to send a PR if you tell me the preferred shape. Closing is fine if it doesn't fit.
