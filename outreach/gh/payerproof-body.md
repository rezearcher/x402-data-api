Grey Ridge (payTo 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10, host x402-data-api.sigrunner.workers.dev) is an x402 seller on Base with 24 routes; it would be a good fit to be scored or listed in PayerProof. Separately, your buyers who trade tokens may want a token check next to your service-trust score:

Free preview (no wallet, same shape as paid):

```bash
B=https://x402-data-api.sigrunner.workers.dev
curl -s "$B/gate/swap/preview?token=weth"
```

Paid: `/gate/swap?token=<addr>&side=buy&notional_usd=100`, $0.008 USDC via x402 on Base. Returns go/hold/block from honeypot sell-simulation (eth_call), measured transfer tax (eth_simulateV1), liquidity depth and admin-control flags. Methodology and measured numbers (short window, not an SLA): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

Closing is fine if it doesn't fit.
