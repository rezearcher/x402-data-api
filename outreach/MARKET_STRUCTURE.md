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

## x402 AGGREGATOR/ROUTER listings are near-zero EV — measured (2026-10-21, cycle 72)
Swept the fresh crop of x402 inference/tool routers for a self-serve path that routes real
BUYER traffic to a listed external endpoint. Ran discriminating traffic checks, not vibes:
- **Toll402** (toll402.dev, "OpenRouter for AI-agent tools", Base USDC x402, 285 curated +
  2,800 proxied): self-serve paid listing exists (`POST /v1/listings`, $1/30d basic, verified
  our `/gate/swap` live — pulled full token-safety desc, amount 8000, correct payTo). BUT the
  catalog's **40 externally-listed x402 endpoints (`kind:external`) have 0 calls in 7 days,
  every single one.** All 1,303 calls/7d go to Toll402's OWN `forged`/`builtin` tools
  (cui_ro_validate 580, jsonld_extract 418). Even curated `provider` vendors (finnhub, tiingo)
  = 0 except one openrouter judge (20). **→ a $1 external listing buys ~0 buyer calls. DEAD
  lever; do NOT spend the $1.** (The only Toll402 path with traffic is `/v1/forge` — Toll402
  HOSTS a generated tool, creator earns 70% — but it's $0.25, not our endpoint, no strategic fit.)
- **Router402** (router402.xyz): HackMoney hackathon gateway, providers HARDCODED to
  Anthropic+Google; "more providers" is an unchecked roadmap item. No self-onboarding. DEAD.
- **surp-router** (ivcained): routes only to the **Surplus Intelligence** marketplace; provider
  listing = Surplus (already emailed support@surplusintelligence.ai cycle 70, PENDING). Not a
  separate surface.
- **Zero.xyz** (142,684 indexed APIs, auto-crawls x402 sellers, real search API
  `POST api.zero.xyz/v1/search`): we ARE indexed (61 services on workers.dev host) and rank
  **#1 of 12** for "is this Base token safe to swap honeypot sellability gate" — flagship
  extracted perfectly. api.greyridgesignals.ai NOT indexed (403s Zero's crawler — expected).
  BUT every host incl. competitors (onchainexpat, agentdata-api, x402-gateway) =
  `state:unrated, successRate:0.00, activations:0`. The "unknown/unrated" status is
  **ecosystem-wide**, not a fixable leak on our end — nobody has activations because ~nobody
  buys through these routers. We are already optimally placed on Zero; nothing to ship there.
- **ROOT:** aggregator/router listings don't convert because the x402 data/tool buyer market
  has ~0 real call volume (de-washed data lane ~$37/day, see market-sizing). Discovery was
  never the leak; demand is. **Do-not-repeat:** don't list on / pitch x402 routers/aggregators
  expecting buyer calls, and don't spend capital on a directory listing. The only channels that
  convert are DIRECT integrations a dev wires (Miles/LiquidLogicX ball-in-court; merged wire-PRs).

## Surp (surp.ivc.lol) compute marketplace — MEASURED DEAD-FOR-US (cycle 78, 2026-10-21)
- Probed the live keyless public API (`GET /api/providers`, `GET /api/markets`) off the
  ivcained/surp-hermes-x402-llm plugin (pushed today). It is NOT a niche: **353 models, 32
  providers** (OpenAI, Together AI, Fireworks, Groq, DeepSeek, Bedrock, Vertex, OpenRouter,
  Anthropic, Mistral — mostly `trusted:true`/curated allowlist).
- Our exact target model `llama-3.3-70b-instruct` already has **120 sellers**. Jev (their
  decision model) selects per request on price/latency/cache/health. We proxy a single Workers-AI
  upstream → **no price edge, no TPS/latency edge** → a 121st commodity-llama offer would win ~0
  routed volume. Plus seller registration needs Rez's wallet **SIWE** (identity gate) and the
  keyless-host allowlist (emailed support@, pending).
- **Do-not-repeat:** do NOT pursue listing as a Surp (or any router-marketplace) commodity
  inference seller — it is a price auction against hyperscalers we structurally lose. The Surplus
  allowlist email can stay (costless) but is not a first-dollar path.
- **Redirect (the edge that actually converts):** our compute lane wins only as an **ADDITIVE
  reliability fallback** — wired as a router's secondary provider that fires solely when the
  primary fails (adexto PR #5 = live reference impl, byte-identical when env unset). No price war,
  no auction, buyer pays $0 until their primary breaks. Position on keyless + measured uptime,
  never on "cheaper". Sharpened the llms.txt compute line to lead with this (cycle 78).

## Agent-side auto-payers fail-closed on BESPOKE trust credentials — not bare x402 (cycle 83, 2026-10-21)
The actual *buyer* shape (an agent that auto-pays sellers on a 402) keeps turning out to be
non-convertible for us for the SAME structural reason, confirmed across three independent sources
this cycle — this is a **targeting discriminator**, not a one-off:

- **sovereign-inference `sip-openai-proxy`** (joshuaswarren, PR #56 CLOSED): the router's client
  (`packages/router/src/sip_router/client.py`) requires `GET /sip/v1/health` (we don't serve it →
  skipped as "unhealthy") AND reads a SIP-specific `sip_payment_required` challenge on the 402
  (we return standard x402 `accepts`/EIP-3009 → `payment_required` → fail over). So a published
  registry file pointing `--registry <url>` at us would NOT route — **vaporware if claimed.**
  Maintainer declined the registry listing on "can't vouch for a paid 3rd-party we don't run" +
  "a signature shows who wrote the file, not that the endpoint is honest/price-stable."
- **slothpay** (eddyflores100-lang): a Base/x402 nightly auto-payer that fetches each `wants.json`
  resource, and on a 402 reads the seller's **ATC/1.0 payment credential**, verifies rev-4
  fail-closed (R0–R4, "any doubt = deny"), then pays. Bare-price x402 with no ATC/1.0 credential
  = **denied.** slothpay + the ATC/1.0 trust API (`uta-trust-api.eddyflores100.workers.dev`,
  $0.01/verify) + `alicelabs-llc/universal-trust-adapter` are **all one author** (eddyflores100),
  a **1-star hacktoberfest ecosystem with zero external adoption.**

**Generalizable rule (do-not-repeat):** an agent-side payer that fail-closes unless the seller
presents a *bespoke* signed trust/payment credential (SIP `sip_payment_required`, ATC/1.0, etc.)
is **non-convertible for us without implementing that exact format** — and implementing a bespoke
credential is only worth it when that format has **real external adoption** (multiple independent
consumers), never for a single-author/0–1-star project. Skip these as first-dollar targets.
**Right investment direction** = the trust gap itself is real (buyers fail-closed on unverifiable
claims; see also joshuaswarren), so our measured provenance (MIT license + public repo +
EVIDENCE.md + real settled tx, cycles 80–81) is the correct, standard-agnostic trust asset —
keep that current. Only adopt a specific credential format once it clears the adoption bar above.

## ERC-8004 / 8004scan is a CDP-Bazaar-shaped DEAD lever — do NOT spend capital on a mint (cycle 84, 2026-10-21)
Chased a real signal: live on-chain buyer `0xf86e616a` pays competitor **onchainexpat** $0.15/call
($4.95/day) for token-safety (see [[x402-token-safety-demand-is-real]]). onchainexpat's 402 responses
carry a `link:` header advertising **ERC-8004 feedback** ("agent 22778", Reputation Registry claimed
at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` on Base). Investigated whether registering Grey Ridge
in ERC-8004 would put us in front of that buyer. **Verdict: no — it's txn-gated bot-spam, same fatal
shape as CDP Bazaar.**

Evidence (researched this cycle, two web-fetch passes):
- **ERC-8004 is identity+reputation, NOT a capability-search surface.** The spec (EIP-8004, Draft
  2025-08-13) defines no on-chain function to search agents by service/skill/category. Discovery
  depends entirely on off-chain indexers.
- **Registration needs an on-chain mint** — `register(agentURI,…)` mints an ERC-721 agentId; requires
  a wallet + ETH gas on the chosen chain. No spec-defined gasless path for registration (7702 sponsor
  is only for *feedback* submitters). = **capital + Rez's wallet = atom, not zero-capital.**
- **8004scan.io (the directory) is bot-spam-saturated:** 935,024 agents, **+126,620 in 24h**; newest
  listings are auto-generated "CUSTOMX402" entries with Feedback 0 / Stars 0 / Score 0. Has text +
  "AI semantic" search and a Base chain filter, but **no category/skill filter and ZERO buyer-side
  traffic metrics** (no calls/payment-volume shown). No evidence any buyer discovers providers here.
- The buyer paying onchainexpat almost certainly did NOT find them by browsing 935k spam agents.

**Do-not-repeat:** do NOT register in ERC-8004 / mint an agentId / spend Rez capital chasing 8004scan
rank. It is CDP-Bazaar II (frozen/txn-gated + spam-flooded + no buyer traffic). Serving an inert
`agent-registration.json` without a mint is unverifiable and equally pointless.
**Transferable win kept:** the ONE thing that mattered — buyers trust on-chain **proofOfPayment** — we
already serve standard-agnostically via `docs/EVIDENCE.md` (real settled Base txHash) + MIT/provenance
anchors (cycles 80-81). Keep that current; it's the right trust asset regardless of registry fashion.
**Zero-capital action taken instead:** aligned the `token-security` A2A skill description to lead with
the buyer's natural-language query ("Is this Base token a honeypot or a rug pull? Can an agent actually
sell it?") instead of EIP-1967/1822 jargon — matches its gate-swap/token-report siblings, helps EVERY
semantic indexer (x402scan, any A2A crawler, even 8004scan's AI search), not just one dead surface.

---

## 2026-10-21 (cycle 86) — reference-registry maintainers won't VOUCH, but DO invite adapter CODE (discriminator)

sovereign-inference (SIP-AI router, joshuaswarren) **closed our signed provider-manifest PR #56**
with a careful, generalizable rationale (quote kept in `outreach/replies/2026-10-21_sovereign-inference-close.md`):

- A listing in a project's **reference registry reads as the project vouching for a provider** — maintainers
  will NOT vouch for a paid third-party service they don't run. A valid Ed25519 signature proves authorship,
  **not** endpoint honesty / price-stability / logging-policy truth. Live endpoints drift → stale registry entry.
- **But he explicitly invited two real paths:** (1) *publish the manifest from our own site* — any router
  can `--registry <our-url>` (self-host, no vouching needed); (2) *an adapter under `adapters/` with tests is welcome*
  (the external-provider code path), + an issue proposing documented third-party-registry use.

**Generalizable discriminator (apply to ALL router/aggregator targets going forward):**
- A **registry-listing** ask = asking the maintainer to vouch → structurally declines for paid 3rd-party. STOP pitching listings.
- An **adapter/code contribution with tests** = the convertible path (same shape as Haven/ArbiVault merges).
- **BUT gate it on buyer volume.** sovereign-inference is 0★ hackathon; its adapters (provider-akash/nosana) are
  decentralized-GPU-market provisioners (provision/teardown lifecycle) — our hosted-HTTP-endpoint shape doesn't even
  map to that ABC cleanly, and the repo has ~0 buyers. Writing a CI-passing adapter for a buyer-empty router fails EV.
  **Rule: only invest adapter code where the router has demonstrated external buyer traffic.** Keep manifest self-host
  (zero-cost) in back pocket; invest code only on a router that shows real paying buyers.
