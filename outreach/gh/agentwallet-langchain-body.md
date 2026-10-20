Your toolkit has a `swap` StructuredTool next to `x402`, so an agent can sign a swap on any token the LLM names. A pre-swap check for Base tokens would close the honeypot/rug hole without a contract deployment.

Grey Ridge's gate returns go/hold/block from a honeypot sell-simulation (eth_call), measured transfer tax, liquidity depth and admin-control flags. Free preview, no wallet, any Base token (3/IP/day):

```bash
curl -s "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=<0x…>"
# -> {"decision":"go","verdict":"SAFE","risk_score":20,"liquidity_usd":381119,...}
```

Paid: `/gate/swap?token=<addr>&side=buy&notional_usd=100`, $0.008 USDC via x402, which your `x402` tool could pay itself. A ready LangChain/CLI guard is in https://github.com/rezearcher/greyridge-x402-tools (`swap-gate.mjs`). Methodology and measured numbers (short window, not an SLA): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

I can send a PR adding it as an optional `preSwapCheck` option on the swap tool if that shape fits. Closing is fine if not.
