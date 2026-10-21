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
4. **PR into a discovery surface's public catalog data file** — like X402blockchains,
   but for curated marketplaces whose listing data lives in a public repo. Done 2026-10-21:
   **edgeandnode/ampersend-sdk PR #149** adds us to `example-services.md` (the ampersend
   agent's hand-picked "first-try" service list; filled the missing token-safety category).
   Ampersend = buyer-facing agent-wallet marketplace by The Graph; Base-USDC, `exact` scheme.

## Ecosystem-directory census (2026-10-21 — the full coinbase/x402 README list, do not re-scan)
The official coinbase/x402 README names exactly 5 community directories. Status of each:
- **x402scan.com** — listed (61 routes re-registered each run). JS-rendered; tRPC API,
  procedure names not guessable. Rank is quality(paid-activity)-gated like Bazaar.
- **Agentic.Market** — listed (unenriched, per memory).
- **x402-list.com** — submitted (per memory). 402-handshake monitored directory.
- **pay.sh** — **Solana-centric**, no documented submission path, gateway-spec YAML loaded
  by your own gateway. Chain-mismatch, low fit. Skip.
- **app.ampersend.ai/discover** — buyer-facing agent-wallet marketplace (The Graph /
  edgeandnode). 3 listing sources: `catalog` (hand-curated, server-side — no self-serve
  form/PR), `bazaar` (= CDP Bazaar, txn-gated/dead), `registry` (ERC-8004). Self-serve
  "Hosted Endpoint" path needs an **ampersend account login** AND reroutes settlement
  through their proxy wallet (not our payTo) → account atom, undesirable routing. BUT the
  SDK repo's `example-services.md` IS a public PR-able data file → PR #149 (above).
Conclusion: no NEW zero-capital self-serve buyer-facing registry exists beyond what we're
already on. The ampersend account-listing path is the one remaining Rez-atom option.

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

## Manifest/402 shape is NOT the blocker — VERIFIED v2-compliant (2026-10-21, cycle 53)
Ruled out the "our discovery manifest/402 is unsignable → silent conversion killer"
hypothesis with authoritative evidence from the *installed* `@x402/core` schema:
- `node_modules/@x402/core/.../schemas/index.d.ts:205` — "V2 uses `amount` instead of
  `maxAmountRequired` and doesn't include resource info." `PaymentRequirementsV2Schema` =
  `{scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra}`; the 402's top-level
  `resource:{url,description,...}` carries the URL (not per-accept).
- Our LIVE 402 on `/gate/swap` returns EXACTLY those fields (`amount:"8000"`,
  `asset:0x833589…` = Base USDC **contract**, `payTo`, `maxTimeoutSeconds:300`, `extra`)
  + top-level `resource.url`. Fully v2-signable by stock `x402-fetch`/`wrapFetchWithPayment`.
- CDP facilitator `@coinbase/cdp-sdk .../guardrails/apply.ts:166` reads `amount` first,
  falls back to `maxAmountRequired` — so our v2 `amount` is parsed correctly.
- Our `.well-known/x402` also emits BOTH `amount`+`maxAmountRequired`+per-resource `resource`
  (belt-and-suspenders, covers v1 clients too). Payable per x402-measure's 4-field rubric
  (network+asset-as-contract+amount-atomic+payTo); we are in the ~8.2% payable elite.
- meloliva14/x402-measure (active public network scoreboard, pushed hourly) probes us at
  `/chain/tx` only; a researcher/measurer, not a buyer. Do NOT pitch (measurers don't pay).
- **Do-not-repeat:** don't re-investigate manifest/402 field shape as a conversion cause.
  The blocker is demand (buyer-empty tiny lane), not discovery-shape or signability.

## Self-serve-safety is a 3rd structural non-buyer class (2026-10-21, cycle 55)
Six fresh replies in one batch, all NOs. Beyond chain-mismatch (fly.ai=Robinhood, pokter=BNB)
and seller-saturation, a distinct non-buyer class emerged on the **token-safety lane**:
- **self-serve / no-paid-third-party**: the team already screens tokens itself and won't
  outsource it. agent-firewall ("local and rule-based ... no tool data sent to a third
  party"), polyrob ("do not plan to add a paid third-party provider to the token-safety
  path"), fly.ai ("we already use GoPlus across the chains we trade").
- Root cause: token-safety is a **commodity buyers get free** (GoPlus) or self-host (local
  rules). There is ~no willingness-to-pay for hosted token-safety among agents that have
  already solved it. This is why token-safety replies NO even when Base-fit.
- **Implication:** the lane with real willingness-to-pay is **compute** (cheap LLM fallback)
  — self-hosting inference is expensive, so a per-call x402 fallback is worth paying for.
  Our one non-close lead (adexto, "leaving open, will evaluate") lives here, not token-safety.
- **Shipped:** `SELF_SAFETY` regex + `SELF_SERVE` tier in scripts/buyer_intent_scanner.py
  demote self-serve-safety repos so future cycles don't burn pitches on this shape.
- **Do-not-repeat:** don't pitch token-safety to firewall/screening/agent-safety projects
  or to teams that name GoPlus/local-rules — they are the self-serve class, EV ~$0.
