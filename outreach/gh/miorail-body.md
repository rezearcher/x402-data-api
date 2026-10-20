Miorail's rule is "no data, no score" and it measures exact exit cost per token address. For the *route/execution* layer (before a plan is prepared for a Base Account to sign), one more independent evidence input could be a simulation-based token verdict: honeypot sell-simulation via eth_call, measured transfer tax (eth_simulateV1), pool liquidity and price impact at your size, admin-control flags, one go/hold/block.

Grey Ridge has that as a pay-per-call endpoint on Base (x402, USDC). Free preview, no wallet, same response shape as paid:

```bash
B=https://x402-data-api.sigrunner.workers.dev
curl -s "$B/gate/swap/preview?token=weth"
curl -s "$B/chain/token-report/preview?token=0xYourBaseToken"   # 3 free real-token checks/day/IP
```

Paid route: `/gate/swap?token=<addr>&side=buy&notional_usd=100` at $0.008. Measured on our probe (240 samples / ~4h): 100% success, p50 ~1.1s / p95 ~1.7s. That is a short window, not an SLA; details in docs/STATUS.md. If a check fails we return no verdict rather than a fake "safe".

If it fits your PLUGIN_REGISTRY, I can send a PR adding it as an optional provider. Closing is fine if not. Details: https://x402-data-api.sigrunner.workers.dev/llms.txt
