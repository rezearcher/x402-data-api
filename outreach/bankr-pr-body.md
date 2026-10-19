Re-opening #573 rebased on current `main` (that PR went conflicting after upstream README changes; this branch is cut fresh from `main` HEAD).

Adds the **grey-ridge-x402** skill: Base-native x402 data + token security for agents.

**Provider:** Grey Ridge Signals, https://x402-data-api.sigrunner.workers.dev

- **Token security** ($0.02, `/chain/token-security`): honeypot simulation via `eth_call` state override, proxy/upgradeability detection, bytecode red-flag scan, ownership state, returns a `clear|review|block` verdict. Useful as a pre-trade check for Bankr agents.
- **Base RPC** ($0.001/call): block, gas (EIP-1559 + `gas_price_usd`), ETH/ERC-20 balances (+ `balance_usd`), tx, receipt, wallet bundle.
- **Crypto signals**: `/crypto/prices`, `/crypto/funding` (cross-venue funding arb), `/defi/yields`.
- **Prediction markets**: live Polymarket via `/pm/markets`.
- **Access:** x402 pay-per-call, USDC on Base (`eip155:8453`, scheme `exact`), no account or API key; free `/preview` route on every endpoint; MCP server at `/mcp`. Machine-readable catalog: `/.well-known/x402`.

Files: `grey-ridge-x402/SKILL.md`, `grey-ridge-x402/catalog.json`, and one provider-table row in `README.md` (after Zerion).

Try it free (no wallet): `curl -s https://x402-data-api.sigrunner.workers.dev/chain/gas-price/preview`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
