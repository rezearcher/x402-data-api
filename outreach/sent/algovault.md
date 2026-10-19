Hi — saw crypto-quant-signal-mcp does funding-rate arb scanning + regime detection via MCP. We run a keyless x402 data API on Base that plugs straight into that, no API key or account (agent pays per call inline in USDC):

- **`GET /crypto/funding`** ($0.001) — **cross-venue** perp funding (Hyperliquid + OKX) with the computed **funding spread + best long/short venue** — the arb signal itself, not a single-venue list.
- **`GET /chain/token-report`** ($0.05) — decision-grade **SAFE / CAUTION / AVOID** verdict for a Base ERC-20 (live honeypot state-override sim, proxy/upgradeability, tax-mutability, pool liquidity, risk_score 0–100) — a pre-trade safety gate for anything your brain is about to size into.
- Also `/defi/yields` (IL-risk aware), `/crypto/prices`, `/pm/markets`, and a 22-tool MCP server at `/mcp`.

Free preview on every endpoint (no payment): https://x402-data-api.sigrunner.workers.dev/.well-known/x402 · MCP at `/mcp`. Base mainnet, USDC, settles via x402 v2.

Happy to shape the payload to whatever your signal pipeline wants — what would be most useful to wire in first?
