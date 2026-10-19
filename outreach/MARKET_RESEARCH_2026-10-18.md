# x402 Market Research — what actually earns (2026-10-18)

## Hard numbers (primary sources: dev.to measurements of x402-list + CDP Bazaar)
- WHOLE x402 market = ~$17/day. All 575 services settled **$516.96 in 30 days**. Top earner (jarvisclaw, LLM gateway) took 78.6%; top 3 = 93.5%. Median earner $0.49/mo. Only 26/575 (4.5%) earned anything.
- Price is NOT the lever: earners & non-earners both median $0.01. **Paying wallets are the signal.**
- ONE real buyer pool: **EVM chain-reads, owned by api.onesource.io** — top-8 endpoints have **437–678 paying wallets each** (erc20-balance $0.003/678w, block-number $0.001/631w, live-balance $0.003/607w). Next-best host in that category: 39 wallets. Everything else market-wide: <40 wallets. Search (Exa resale) ~176 wallets.
- OneSource is **Ethereum-focused**. We are **Base-native and serve the identical endpoints** → our wedge.
- Token-safety is a CROWDED, non-paying lane (Agent402 token-risk/token-risk-pro, Address Risk, SYNTHORA, Agent Guard, RugCheck AI, onchain-safety-mcp). Not a top paying category.
- New entrants in chain-reads: GoldRush/Covalent (60+ endpoints, 100+ chains), Nansen ($0.01 basic / $0.05 premium).

## Committed strategy
1. **Compete in chain-reads as THE Base-native option** (balance, block-number, token-balance) — the only lane with hundreds of real paying wallets. De-emphasize token-safety SKU (crowded/dead).
2. **Discovery maxed** this session: CDP Bazaar (13 endpoints), MCP Registry (active), Agent402.tools (listed+routable, 22 tools), x402scan, awesome-x402.
3. **Honest ceiling:** even winning Base chain-reads caps at single-digit $/day. x402-data-api = validation probe (can we get ONE real external payer?), NOT the money engine. Real money needs a different shape (vertical, outcome-priced, bigger ticket) per winner-shape thesis.

## Sources
- dev.to/ofirbaranesadagent "I fixed the payment rail. Still $0..." (2026-08-28 data)
- dev.to/tanod "What AI agents pay per call, part 3" (2026-10-09 Bazaar snapshot)
- agent402.tools leaderboard; goldrush.dev, nansen.ai x402 docs

## DEEP-DIVE ADDENDUM (buyer repos + full Bazaar crawl, 25,798 resources)
### #1 concrete $0 cause: WE ARE DELISTED FROM SEARCH
- Our 13 resources: lastCalledAt 2026-08-12..09-01. CDP drops a resource from catalog+search after 30d with no settlement. We're in merchant feed but NOT in the paged /resources search buyers use. We rank last (quality = recent calls × unique payers = 0).
- FIX (highest leverage): settle ONE real call through the CDP Facilitator w/ bazaar extension to re-enter search. Per CDP docs this is legitimate+required. Do NOT repeat to inflate (that's the fraud line).

### Product defect: honeypot sim broken where it matters
- Our state-override sim probes balance slots 0-3 only → "unavailable" on proxy/USDC-style tokens (seen in our own live challenge example). The sim IS our differentiator; fix slot detection (ERC-1967 proxy-aware, wider slot scan / known-slot map) before selling it.

### Sharpest monetizable product (evidence-ranked)
- `GET /gate/swap?token=&side=buy&notional=` → {go|hold|block, reason}, <1s, $0.01. Buyers = autonomous Base execution agents (CrewAI/Virtuals/true402 meme-traders, wallet-agents like keyring-agent $0.05/send). Hot-path recurring calls: sniperx 17 payers→22.9k calls; keyring ~55 payers→14.6k calls; x402node honeypot 22 payers@$0.01. One-off audits die (1-6 calls).
- Pricing: $0.02-0.05 band gets ~50% of all calls. Our $0.001 reads & $0.10 scan are fine; discovery is the problem, not price.
- Only uncapped example: AX1 Console — $0.02 entertainment "roast verdict" social card on Base tokens, ~$6k/mo, 2,992 payers. Consumer social product, not an API. The shape worth testing for real upside.
- DEAD, don't build: static MCP-scan audits, cross-venue funding ($85 total), prediction-market feeds.

### Market size reality-check
- x402scan: ~3.0M tx / $1.12M / 36.4k buyers (30d). Bazaar-visible: ~815k calls/30d, ~$24k est rev, top-10 take ~75%. 25-30% of volume is leaderboard-farming (Coinbase's own head of AI product). The "79k/day" figure is inflated per Visa/Artemis.
