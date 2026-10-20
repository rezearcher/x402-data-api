Your /review gives a verdict before an irreversible action; for a swap, the single most decision-relevant input is whether the output token can actually be sold and what it taxes. Grey Ridge sells that as a cheap composable x402 call, so /review could cite it as evidence, and I'm happy to build that wiring as a PR if you'd take it.

Free preview (no wallet, same shape as paid):

```bash
B=https://x402-data-api.sigrunner.workers.dev
curl -s "$B/gate/swap/preview?token=weth"
```

Paid: `/gate/swap?token=<addr>&side=buy&notional_usd=100`, $0.008 USDC via x402 on Base. Returns go/hold/block from honeypot sell-simulation (eth_call), measured transfer tax (eth_simulateV1), liquidity depth and admin-control flags. Methodology and measured numbers (short window, not an SLA): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

Closing is fine if it doesn't fit.
