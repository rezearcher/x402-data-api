Your treasurer pays allowlisted x402 endpoints in USDC on Base. If you want a candidate for the allowlist that's useful for a Base treasury: Grey Ridge has a pre-trade token gate and token report, priced in cents and settled via x402 on Base.

Free preview (no wallet, same shape as paid), so you can evaluate before allowlisting:

```bash
B=https://x402-data-api.sigrunner.workers.dev
curl -s "$B/gate/swap/preview?token=weth"
curl -s "$B/chain/token-report/preview?token=usdc"
```

Paid: `/gate/swap?token=<addr>&side=buy&notional_usd=100` at $0.008 USDC (payTo 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10). It runs a honeypot sell-simulation (eth_call), measured transfer tax (eth_simulateV1), liquidity depth and admin-control flags, and returns go/hold/block. Methodology and measured latency (short window, not an SLA): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

Two options: add the host to your allowlist for a trial call, or use it as a pre-flight before any token swap your treasurer might do. Happy to adapt the response shape to your ledger format. Closing is fine if it doesn't fit.
