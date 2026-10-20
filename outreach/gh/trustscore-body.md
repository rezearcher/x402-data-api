TrustScore answers "is this *service* safe to pay?" — an agent that then trades also needs "is this *token* safe to buy?". Grey Ridge has a pay-per-call endpoint on Base for that second question, which fits next to your service-trust check in the CrewAI/LangChain integrations:

```bash
B=https://x402-data-api.sigrunner.workers.dev
# free preview, no wallet, same response shape as paid
curl -s "$B/gate/swap/preview?token=weth"
# -> {"decision":"go","verdict":"SAFE","risk_score":0,"flags":[...],...}
```

One call returns go/hold/block from honeypot sell-simulation (eth_call), measured transfer tax (eth_simulateV1), liquidity depth and admin-control flags. Paid route: `/gate/swap?token=<addr>&side=buy&notional_usd=100`, $0.008 USDC via x402 on Base. Measured numbers + methodology (short window, not an SLA): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

Two asks, either is fine: (1) if Grey Ridge's x402 service belongs in your registry, I'm happy to submit it in whatever format you prefer; (2) I can send a PR adding `gate/swap` as an optional token-safety tool in `integrations/langchain` and `integrations/crewai`. Tell me which shape you'd merge. Closing is fine if it doesn't fit.
