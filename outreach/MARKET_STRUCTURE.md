# x402 token-safety market structure — ground truth (2026-10-21)

Consolidated so future cycles STOP re-running proven-dead levers. Every claim below is
backed by a measurement run this cycle or a cited reply, not opinion.

## Headline
The x402 **token-safety** space is **seller-saturated and buyer-empty** right now.
Many providers sell it; the only measured buyers are anonymous sweeper-bots plus one
anonymous wallet paying a competitor. The $1,000/day goal is bottlenecked by near-zero
real demand on Base x402, **not** by our distribution. Our product + listings + prices
are already competitive (31× cheaper than the dearest rival); pushing more distribution
into an empty market is low-EV.

## Evidence

### 1. Demand side is empty (3 independent operators agree)
- **Us:** `onchain_demand_by_lane` → true external revenue ≈ $0.77 bot dust; the "$70
  external" headline is pre-launch funding (self-wallets).
- **swarm-agent-operator** (`swarm-x402-mcp#2`, 2026-10-19): "it matches our numbers
  almost exactly: sweepers and probes, no repeat buyers. We're measuring every Base
  seller in the Bazaar right now … sweepers removed."
- **romudille-bit/agentpay#11** (2026-10-19): manifest/OpenAPI/bazaar-extension "in good
  shape … there's no seller s[ignal]" — i.e. no buyer traffic to convert.
- The one real paying token-safety buyer found on-chain, `0xf86e616a…` (~$4.95/day to
  onchainexpat at $0.15/call), has **zero GitHub/web3.bio footprint** → unreachable.

### 2. Supply side is saturated (everyone sells token-safety)
Providers all pitching the same agent frameworks: Grey Ridge (us), onchainexpat,
StalkChain, SafeAgent/cryptogenesis.duckdns.org, Insight (imokokok), GoPlus (incumbent),
agentsvc, grokbot-hk, lanescrypt, losbeto. Inbound-intent GitHub search (issues asking
to *add* token-safety, authored by non-us) returns **only competitor self-pitches**
(e.g. `agno#456` = SafeAgent copied from upstream `agno-agi/agno#7350`; `HevoLaunch#2` =
Insight; `awesome-blockrun#126` = StalkChain). No genuine unclaimed Base buyer-want exists.

### 3. CDP Bazaar discovery is a DEAD lever — now with the mechanism
Measured this cycle: the CDP discovery feed (`/platform/v2/x402/discovery/resources`) is
**transaction-gated**. Of our 62 routes, exactly **1** appears in the first 4,000 items
(`/defi/yields` at pos 1,100) — and only because it caught bot-sweep payments. Our
token-safety routes have ~0 external txns → never crawled → absent → undiscoverable →
no txns. Chicken-and-egg the forbidden self-pay can't break. Ordering is by `quality`
(paid activity), not recency/price, so being 31× cheaper does not help rank. STOP trying
to "improve Bazaar discoverability / re-index / tune serviceName"; it cannot move without
paid activity we're not allowed to manufacture.

### 4. Outbound pitching is saturated + forbidden
`cold-outreach-pitches` lever = 144 pulls, $0, in `forbidden_levers`. Fresh NOs are
**structural chain-mismatch** (Robinhood Chain: fly.ai; BNB: pokter; XRP: switchbord/
Sluzen; Solana/NEAR: svalin) or "we don't take third-party paid providers" (policy).

## What still has a live edge (where to spend the limited effort)
1. **X402blockchains/x402-registry** — the one registry that *actively verifies* endpoints
   and is mid-approval of us (proposal PR #19, all 4 review items + labelled Base mainnet
   settlement tx submitted). Fresh, verified discovery surface. Ball-in-court — do NOT re-ping.
2. **x402scan** — memory's "real $ = x402scan"; keep listing/prices accurate (already is).
3. **Inbound wire-PRs to repos already calling OUR URL** — the only pattern that ever
   merged (Haven, ArbiVault). Code-search is currently saturated (0 new), but a *new*
   referencing repo is the highest-converting target when one appears.

## Do-not-repeat (proven $0)
- CDP Bazaar rank / serviceName / desc tuning / re-index (transaction-gated, §3).
- Cold outbound pitches to seller-saturated agent frameworks (§2, §4; 144 pulls).
- On-chain buyer deanon (web3.bio: no contact records; §1).
- The coinbase/x402 ecosystem "add us" PRs (0/15+ ever merged).

## Compute lane (added 2026-10-21zn)
We run a REAL live OpenAI-compatible LLM endpoint `/v1/chat/completions` ($0.002/call,
Llama-3.3-70b-instruct-fp8-fast, free-preview at `/preview`, in `.well-known/x402`).
This is a **distinct lane from token-safety/data** — the ONLY warm pitch-reply to date
(0xcuy/adexto "Agent Compute") lives here, not token-safety. Open wire-PR adexto#5
(MERGEABLE/CLEAN) is the single best Base-compatible conversion path.
- Compute lane is ALSO seller-dominated: mapleai-gateway (sells own GPT/Claude over x402),
  openzoo (Solana-rail proxy) are SELLERS, not buyers. Pitched mapleai in error — now the
  buyer_intent_scanner COMPUTE_SELLER discriminator filters them (commit 94c1d99).
- Do-not-repeat: don't pitch compute SELLERS (own-models LLM gateways/inference providers);
  don't pitch Solana-rail proxies (openzoo). Genuine compute BUYER = routes LLM calls, wants
  cheap/fallback provider, Base-x402-capable, non-seller (adexto is ~the whole set today).
