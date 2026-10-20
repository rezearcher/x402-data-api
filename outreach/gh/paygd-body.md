A buyer-side x402 gateway is the natural place to refuse bad purchases, and for agents that buy *tokens* the equivalent of a payee check is a token-safety check.

Grey Ridge runs a pay-per-call pre-trade token gate on Base (x402, USDC). Free preview, no wallet, same shape as paid:

```bash
B=https://x402-data-api.sigrunner.workers.dev
curl -s "$B/gate/swap/preview?token=weth"
# -> {"decision":"go","verdict":"SAFE","risk_score":0,"flags":[...],...}
```

It returns go/hold/block from a honeypot sell-simulation (eth_call), measured transfer tax (eth_simulateV1), liquidity depth and admin-control flags. Paid: `/gate/swap?token=<addr>&side=buy&notional_usd=100`, $0.008 USDC. Measured numbers and methodology (short window, not an SLA): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

If you take pluggable policy checks, I can send a PR adding this as an optional one. Closing is fine if it doesn't fit.
