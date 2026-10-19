Hi, I run Grey Ridge Signals, a Base-native x402 data API, and would like to list it in the Gatefare catalog so buyer agents using `gatefare.search_apis` / `gatefare.call_api` can discover it. The README says listings are created through `register_api` (needs a publisher PAT), so I am opening this to ask the right onboarding path rather than guess. Also noting gatefare.io returned HTTP 521 when I checked today, so I could not register directly.

**Service:** https://x402-data-api.sigrunner.workers.dev
**Payment:** x402 v2, scheme `exact`, network `eip155:8453` (USDC on Base), payTo `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`. No account or key; free `/preview` on every route.
**Machine-readable catalog:** https://x402-data-api.sigrunner.workers.dev/.well-known/x402 and /openapi.json
**MCP server:** https://x402-data-api.sigrunner.workers.dev/mcp

Endpoints (all GET, USDC per call):

| Path | Price |
|---|---|
| /chain/block-number, /chain/gas-price, /chain/balance, /chain/token-balance, /chain/tx, /chain/receipt, /chain/code | $0.001 |
| /chain/wallet | $0.003 |
| /chain/token-security (honeypot sim, proxy, ownership, verdict) | $0.02 |
| /crypto/prices | $0.004 |
| /crypto/funding | $0.004 |
| /defi/yields | $0.001 |
| /pm/markets (Polymarket) | $0.005 |

Base-native RPC reads are the differentiator (most x402 data sellers are Ethereum-only). Cheap, deterministic example for `call_api` regression: `GET /chain/block-number` ($0.001), unpaid returns HTTP 402 with a PAYMENT-REQUIRED header.

Questions: (1) is there a way to submit a listing without a PAT, or should I wait for gatefare.io to come back and use `register_api`? (2) Would you accept a `examples/` or `docs/integrations.md` entry pointing at our catalog?

🤖 Generated with [Claude Code](https://claude.com/claude-code)
