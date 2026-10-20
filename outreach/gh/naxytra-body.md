Naxytra executes pay-per-call actions for agents on Base; a pre-execution guard that checks the buy-side token first would pair naturally. Grey Ridge has a simulation-based one (honeypot sell-sim via eth_call, measured transfer tax via eth_simulateV1, pool liquidity and price impact at your size, admin-control flags, one go/hold/block) as a pay-per-call endpoint on Base (x402, USDC):


```bash
B=https://x402-data-api.sigrunner.workers.dev
curl -s "$B/gate/swap/preview?token=weth"
curl -s "$B/chain/token-report/preview?token=0xYourBaseToken"   # 3 free real-token checks/day/IP
```

Paid route: `/gate/swap?token=<addr>&side=buy&notional_usd=100` at $0.008. Measured on our probe (240 samples / ~4h): 100% success, p50 ~1.1s / p95 ~1.7s. That is a short window, not an SLA; details in docs/STATUS.md. If a check fails we return no verdict rather than a fake "safe".

I can send a PR wiring it in as an optional pre-check tool if you tell me the preferred shape. Closing is fine if not. Details: https://x402-data-api.sigrunner.workers.dev/llms.txt
