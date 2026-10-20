Your README mentions a path for adding a new partner API. Offering one: Grey Ridge's x402 API on Base has a pre-trade token gate and DeFi data your agents don't cover today.

- `GET /gate/swap?token=<0x…>&side=buy&notional_usd=100` ($0.008 USDC): one go/hold/block decision from a honeypot sell-simulation, measured transfer tax and liquidity price impact. Free preview for any Base token (3/IP/day): `curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=weth"`
- `GET /crypto/funding` ($0.004): cross-venue Hyperliquid + OKX + dYdX funding rates, arb spread, best long/short venue.
- Discovery: `/.well-known/x402`, `/openapi.json`, `/llms.txt`, MCP at `/mcp` on the same host.

Measured numbers and methodology (short window, not an SLA): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

If there is a partner checklist (revenue share, listing format, wallet to pay), point me at it and I'll send a PR in your format. Closing is fine if it's not a fit.
