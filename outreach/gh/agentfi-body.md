AgentFi executes swaps for agents behind an on-chain policy layer. One check that's hard to express as a static policy is "is this specific output token a honeypot / fee-on-transfer / admin-controlled right now?" — a token allowlist can't answer it for long-tail tokens.

Grey Ridge has a pay-per-call pre-trade gate on Base that does exactly that, usable as a pre-swap step in your MCP server (before building the Uniswap V3 tx):

```bash
B=https://x402-data-api.sigrunner.workers.dev
# free preview, no wallet, same response shape as paid
curl -s "$B/gate/swap/preview?token=weth"
# -> {"decision":"go","verdict":"SAFE","risk_score":0,"flags":[...],...}
```

It returns go/hold/block from a honeypot sell-simulation (eth_call), measured transfer tax (eth_simulateV1), liquidity depth and admin-control flags. Paid route: `/gate/swap?token=<addr>&side=buy&notional_usd=100`, $0.008 USDC via x402 on Base, so it fits your x402/MPP rails without an API key. Measured numbers and methodology (short window, not an SLA): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

If useful I can send a PR adding it as an optional guard in the swap tool, off by default. Tell me the shape you'd merge. Closing is fine if it doesn't fit.
