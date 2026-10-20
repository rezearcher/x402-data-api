Your agents trade through swaps, so pre-trade token safety is a natural fit. If you want a second, simulation-based signal in the same call (honeypot sell-simulation via on-chain eth_call, transfer-tax measured with eth_simulateV1, liquidity depth, admin-control flags, and one go/hold/block decision), Grey Ridge has a pay-per-call endpoint on Base:

```bash
B=https://x402-data-api.sigrunner.workers.dev
# free preview, no wallet, same response shape as paid
curl -s "$B/gate/swap/preview?token=weth"
# -> {"decision":"go","verdict":"SAFE","risk_score":0,"flags":[...],"token_meta":{"symbol":"WETH",...}}
curl -s "$B/chain/token-report/preview?token=usdc"
```

Paid route is `/gate/swap?token=<addr>&side=buy&notional_usd=100` at $0.008 USDC (x402, Base). Measured on our own probe (240 samples / ~4h): 100% success, token-report p50 ~1.1s / p95 ~1.7s. That's a short window, not an SLA: see https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md.

Happy to send a PR that adds it as an optional provider next to your current check () if you tell me the preferred shape. No pressure; closing is fine if it doesn't fit.

Details: https://x402-data-api.sigrunner.workers.dev/llms.txt
