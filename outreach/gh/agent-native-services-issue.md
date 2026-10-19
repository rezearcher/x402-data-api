### Service name
Grey Ridge Signals — x402 Data & Security APIs

### Official website
https://x402-data-api.sigrunner.workers.dev/

### Official repository
https://github.com/rezearcher/x402-data-api

### Official tagline
"Agent-native, pay-per-call data on Base (USDC via x402). No account, no API key — agents pay inline." (https://x402-data-api.sigrunner.workers.dev/llms.txt)

### Proposed category
Commerce & Payment Services (alternatively Tool Access & Integration Services)

### Admission track
Standard five-criteria track

### Criterion 1 — Agent-first positioning
Quote: "Agent-native, pay-per-call data on Base (USDC via x402). No account, no API key — agents pay inline."
Source URL: https://x402-data-api.sigrunner.workers.dev/llms.txt

### Criterion 2 — Agent-specific primitive
Primitive: `GET /gate/swap` — a pre-trade swap gate. An agent passes a Base token address and gets `allow` / `review` / `block` from a live `eth_call` state-override transfer simulation (can a synthetic wallet actually sell it?), proxy/mint/pause/blacklist/fee-setter selector scan and owner-renounce check, paid per call by inline x402 payment. Also a free `/preview` variant (3/IP/day, any Base token) so an agent can evaluate it before paying.
Why a human would not use this: it is a machine verdict meant to gate an autonomous swap step; there is no human-facing UI, and per-call USDC settlement removes the account/billing setup a human product would need.

### Criterion 3 — Autonomy-compatible control plane
The agent completes the full loop (read 402 terms → sign EIP-3009 → retry → receive verdict) with no human click. Constraints live in the agent's client (per-call ceiling); each route advertises its exact price in the 402 challenge and in OpenAPI `x-payment-info`, so an agent can refuse anything over its ceiling. Prices: $0.001–$0.02 per call.

### Criterion 4 — Integration or operational surface
HTTP + x402 v2 (`exact`, USDC on Base `eip155:8453`), OpenAPI with `x-payment-info` (/openapi.json), `/.well-known/x402`, `llms.txt`, hosted MCP endpoint (`/mcp`, 22 tools), stdio MCP client in the repo, listed in the Coinbase CDP Bazaar / x402scan / Agentic Market.

### Criterion 5 — Identity, attribution, and boundary
No accounts or API keys: the payer is the wallet that signs a single-use exact-amount EIP-3009 authorization, so every call is attributable on-chain to the agent's wallet (settlement visible on Base). We never hold payer keys. Boundary: read-only data and verdicts; no custody, no execution on the agent's behalf.

### Bonus signals
- Supports MCP: https://x402-data-api.sigrunner.workers.dev/mcp
- Dedicated agent identity (wallet as identity)

### Classification
agent-native (standard track)

### Why the obvious generic alternative does not qualify
Generic alternative: a subscription token-security/data API (e.g. GoPlus/DEXTools-style keys).
Why it fails: requires a human account, API key and billing setup before the first call; an autonomous agent cannot onboard or pay for it by itself.

### Disclosure
I operate this service (Grey Ridge Signals Group LLC), so I have a financial interest in it; disclosing it here rather than ticking "no undisclosed financial interest" silently. Production: live on Base mainnet with real settled payments.
