## Add Grey Ridge Signals (Base-native x402 data + security MCP) as a paid tool

ATXP gives agents a wallet + instant access to paid MCP tools. Here's a live, keyless x402 one your users can call today — **no account, no API key**, agent pays inline in USDC on Base.

**MCP endpoint:** `https://x402-data-api.sigrunner.workers.dev/mcp` (22 tools, payment-gated; discovery free)
**Discovery:** https://x402-data-api.sigrunner.workers.dev/.well-known/x402 · `/openapi.json` · `/llms.txt`
**Network:** Base mainnet (eip155:8453), USDC, settles via xpay/CDP facilitator. payTo `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`.

**What it gives an agent (from $0.001/call, free preview on every endpoint):**
- Base-chain RPC reads: block-number, gas-price, balance, **token-balance (now returns symbol/name/decimals + formatted balance — only Base-native endpoint that does; OneSource is Ethereum-only)**, tx, receipt, code, wallet-bundle, EIP-7702 delegate detection
- Token security scan (honeypot/ERC-7201 layout), crypto prices, cross-venue perp funding + spread, DeFi yields with IL risk, Polymarket markets

Happy to adjust the manifest to whatever shape your catalog wants — just point me at the format.
