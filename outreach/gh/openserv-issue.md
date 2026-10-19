Hi, a data source for OpenServ agents that already speak x402: a keyless pay-per-call API on Base (USDC, no account/key) with DeFi/onchain tools an agent can call before it moves money.

Free, no wallet, no key (full response shape):
```bash
curl -s "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=weth"
# {"decision":"go|hold|block","verdict":"SAFE|CAUTION|AVOID","risk_score":..,"liquidity_usd":..,"flags":[..]}
```
Paid over x402 (same shape, no preview limit): `GET /gate/swap` $0.008, `GET /chain/token-report` $0.01 (honeypot sim, proxy/admin risk, tax mutability, liquidity), plus yields/prices/funding routes at $0.001-0.01. Discovery: `/.well-known/x402`; a 22-tool MCP server is at `/mcp`.

If it is useful I can contribute an example (an x402-paid tool that gates a swap action) as an example - point me at the preferred shape. Feel free to close if not relevant.
