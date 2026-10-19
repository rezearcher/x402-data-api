Second-source honeypot/sell-sim check for ARIA's pre-trade safety gate (free preview, pay-per-call)

Hi — ARIA's README says honeypot detection is a hard safety gate on Base. A second, independent source for that gate is cheap insurance when one API is stale or missing a fresh token. We run a keyless x402 API on Base (no account or key; per-call USDC):

- `GET /gate/swap` ($0.008): GO / HOLD / BLOCK sized to your notional, with a live sell simulation, tax and proxy flags, and Uniswap v3 liquidity price impact.
- `GET /chain/token-report` ($0.01): SAFE / CAUTION / AVOID, risk score and reasons.

Free, no-wallet preview of the exact response shape (~1.5 s, any Base 0x address):
`curl "https://api.greyridgesignals.ai/gate/swap/preview?token=0x<base-token>&notional_usd=500"`
`curl "https://api.greyridgesignals.ai/chain/token-report/preview?token=0x<base-token>"`

Measured note: we do not yet publish an accuracy figure; our own check against GoPlus found no honeypots in the tokens we sampled, so run it on tokens you care about before relying on it. Which token or flow should I run for you first? — Grey Ridge Signals, contact@greyridgesignals.ai
