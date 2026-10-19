Hi — your agents carry wallets and x402 fetch, so one practical gap is "should this agent touch this token/contract?" before it signs.

We run a pay-per-call x402 API on Base (USDC, no key/account) with single-purpose reads your agents can call through `x402-fetch`:

- `GET https://api.greyridgesignals.ai/chain/token-security?token=0x…` — honeypot/owner/tax flags
- `GET /gate/swap/preview` — free pre-swap gate preview (no payment); paid version $0.008
- `/chain/token-report`, `/chain/proxy-info`, `/chain/total-supply` — $0.003–0.01

Free previews need no wallet, so you can see the exact response shape first. x402 manifest: https://api.greyridgesignals.ai/.well-known/x402

I can send a ready-to-paste tool definition for your MCP server if useful. Feel free to close if not relevant.
