I noticed `discord/src/screen.ts` screens tokens through GoPlus's free API with a `GOPLUS_GAP_MS = 2_500` gap because it "goes quiet on bursts", and treats an unknown token as a failed read to retry later. If that throttling or the unknown-token gap is a pain, Grey Ridge has a pay-per-call Base endpoint that does a simulation-based check (honeypot sell-simulation via on-chain `eth_call`, measured transfer tax, liquidity depth, admin-control flags) and returns one go/hold/block decision. It works on a token GoPlus hasn't indexed yet, because it reads the chain directly.

```bash
B=https://x402-data-api.sigrunner.workers.dev
# free preview, no wallet, same response shape as paid
curl -s "$B/gate/swap/preview?token=weth"
curl -s "$B/chain/token-report/preview?token=usdc"
```

Paid route is `/gate/swap?token=<addr>&side=buy&notional_usd=100` at $0.008 USDC (x402, Base). Base only today, so it would cover just your `base` entry. Measured on our own probe (240 samples, ~4h): 100% success, token-report p50 ~1.1s / p95 ~1.7s. That is a short window, not an SLA: https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

Happy to send a PR adding it as a second signal beside GoPlus if you tell me the preferred shape. Closing is fine if it doesn't fit.
