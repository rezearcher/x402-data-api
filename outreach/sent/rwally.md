Hi — Rwally ratifies every index rebalance by on-chain vote, which means members are effectively voting on whether to add a token. We run a keyless x402 API on Base that gives a **decision-grade pre-vote safety check** for any ERC-20, no account/API key (agent or frontend pays per call inline in USDC):

- **`GET /chain/token-report`** ($0.05) — **SAFE / CAUTION / AVOID** verdict with a live honeypot **state-override simulation** (can a wallet actually sell it?), proxy/upgradeability detection, owner-renounce check, fee-mutability, Uniswap v3 pool liquidity, and a `risk_score` 0–100 + human-readable `reasons`. Exactly the evidence a rebalance vote should see before a token enters the basket.
- Plus `/chain/wallet`, `/chain/token-balance` (now returns symbol/name/decimals/formatted), `/defi/yields`, `/crypto/prices`.

Free preview, no payment: https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview · manifest at `/.well-known/x402` · MCP at `/mcp`. Base mainnet, USDC.

Could surface this verdict inline on each rebalance proposal — want me to sketch the integration?
