Adds **Grey Ridge Swap Gate** (`@grey-ridge/vercel-ai-swap-gate`) to the AI SDK Tools Registry — a pre-trade token-safety tool for autonomous trading agents on Base.

### What it does
One `createSwapGuard()` tool the model calls before any swap. It wraps a single on-chain safety call and returns a **GO / HOLD / BLOCK** verdict with reasons plus a sizing-aware `proceed` boolean:

- Honeypot + **sellability** check via a live state-override simulation (not a static list)
- Measured buy/sell **transfer tax** against the token's deepest Uniswap-v3 WETH pool
- **Admin control**: owner-renounce + mint / pause / blacklist / fee-setter / upgradeable-proxy, and owner supply concentration
- **Liquidity vs. trade size** — the agent's own notional weighed against pool depth, so it never takes a position it cannot exit

It is **Base-native, keyless, and paid inline** per call in USDC on Base ($0.008) via the [x402](https://x402.org) standard — no account, no API key to store or rotate. It **fails closed**: any outage or unpaid call returns `{ decision: "block", proceed: false }`, so a gate failure can never green-light a swap.

The registry has no on-chain/DeFi pre-trade-safety tool today; this fills that gap at roughly 1/25th the price of a GoPlus-class lookup.

### Checklist (per the contributing guide)
- [x] Published to npm: [`@grey-ridge/vercel-ai-swap-gate`](https://www.npmjs.com/package/@grey-ridge/vercel-ai-swap-gate) (installable, latest `0.1.0`)
- [x] `codeExample` tested against the published package — `createSwapGuard()` imports and builds a valid AI SDK tool (`inputSchema` + `execute`), and the underlying route returns a live verdict
- [x] AI-SDK integration docs: https://api.greyridgesignals.ai/for-agents/vercel-ai-swap-gate
- [x] Keyless on-ramp — with no wallet key the tool reads the free preview (same verdict shape), so it installs and runs without funding

### Honest scope
Verdicts are informational, not financial advice: a cleared trade means no known unsafe pattern matched these static + simulated checks, not a guarantee.
