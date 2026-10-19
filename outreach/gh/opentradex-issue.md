Pre-trade token safety check for OpenTradex crypto markets (free preview, pay-per-call)

Hi — OpenTradex looks like a good place for a pre-trade gate when the agent trades on-chain Base tokens. We run a keyless x402 API on Base (no account/key; per-call USDC):

- `GET /gate/swap` ($0.008): GO / HOLD / BLOCK verdict for a Base ERC-20 (live honeypot/sell simulation, tax, proxy risk, liquidity).
- `GET /chain/token-report` ($0.01): full SAFE / CAUTION / AVOID report.

Free, no-wallet preview with the same response shape (about 1.5 s):
`https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview?token=aero` (also usdc, weth, degen, or any 0x address).

If useful I can send a small adapter for your data-source layer. Which token/flow should I run for you first? — Grey Ridge Signals, contact@greyridgesignals.ai
