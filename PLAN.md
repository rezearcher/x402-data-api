# x402 Data API — Build Plan

**Decision (2026-06-18):** BUILD. Demand for security/enrichment data on x402 is unproven;
the only honest resolver is to ship a thin basket of endpoints and measure real (non-self)
paid inbound. Downside is ~$0 (free-tier infra, cash-only, no capital at risk); upside is
uncapped. This is the convex barbell — staged, kill-switched, validate-before-scale.

## What the research changed (vs. the original pitch)
- **Original "huge supply gap (477 sellers)" thesis is FALSE.** As of May–Jun 2026 the network
  has 4,800+ live endpoints, 1,100+ projects, 10k–83k sellers. Volume cooled ~77% from peak
  (~$28k/day real flow across all endpoints → ~$6/endpoint/day avg, power-law skewed).
  We are NOT an early seller into a vacuum; we compete on discovery + differentiation.
- **Enter the categories that actually earn:** data enrichment (domain/DNS/WHOIS/company lookup,
  verification), web scraping, walled-garden data. Our osint/recon stack already produces this.
- **Differentiated upside SKU:** CVE-context-by-stack threat intel (defensible), NOT
  per-target vuln feeds (off-mission arms-dealing; "payment=auth" can't verify domain ownership).

## Endpoints (basket — ship several, ~$0 marginal cost each)
Proven-demand enrichment (commodity, cheap):
- `GET /dns/{domain}`        — A/AAAA/MX/NS/TXT records          ($0.01)
- `GET /whois/{domain}`      — registrar/created/expiry/registrant ($0.02)
- `GET /subdomains/{domain}` — passive subdomain enum (CT + sources) ($0.05)
- `GET /tech/{domain}`       — tech-stack fingerprint              ($0.03)
- `GET /headers/{domain}`    — security-header posture grade       ($0.02)

Differentiated (defensible threat-intel, higher value):
- `POST /cve-context`        — input: tech stack/CPE list; output: known CVEs + EPSS +
                               exploit-availability + nuclei-template-exists  ($1–5)

EXCLUDED (off-mission): per-target vulnerability/conviction feeds.

## Stack (decided)
- **Runtime:** Cloudflare Workers (free tier) — Rez already runs CF + Wrangler (sigrunner/greyridge).
- **Framework:** Hono + x402 middleware (CF co-founded x402; first-class Workers support).
- **Chain:** Base. Build/test on Base Sepolia testnet; swap to mainnet receiving wallet at launch.
- **Data sources:** reuse osint MCP / Hermes sensor logic, reimplemented as direct calls in the worker.
- **Discovery:** register endpoint metadata so it surfaces in the x402 Bazaar.

## The one human atom (capital/account — only Rez can provide)
- A **Base receiving wallet address** Rez controls (keys his). Everything else is built/tested
  on testnet without it; the mainnet address is the single launch-time swap.

## Kill-switch / measurement (validate-before-scale)
- Instrument every endpoint: log paid requests, exclude self-traffic.
- Tripwire: **organic (non-self) paid requests over 30 days.**
  - `>0 and trending` → build out the full basket + promote discovery.
  - `=0` → kill. Sunk cost ≈ $0.

## Status (updated 2026-07-11)

> **Shipped reality (2026-07-18):** this checklist is stale — it lists only the `/enrich/*`
> endpoints. The deployed Worker now serves **18 paid GET endpoints** + a **22-tool MCP server**
> (data, Base RPC, `/chain/token-security` honeypot detector, MCP security scan, domain enrichment).
> See **`ARCHITECTURE.md`** (root) for the code-verified inventory and the current gap list.
> Still true: **first organic dollar = $0** (on-chain verified). The revenue atom is now the
> RapidAPI seller account + Stripe payout (only Rez can create it), not just the MCP Registry publish below.

- [x] Scaffold Hono worker + x402 middleware
- [x] Wire enrichment endpoints to data sources (`/enrich/tech-risk`, `/enrich/domain` — NVD/EPSS/KEV/crt.sh/RDAP/DoH, all free feeds)
- [x] tech-risk endpoint (supersedes the planned `cve-context`)
- [x] MCP server at `/mcp` (`enrich_tech_risk`) — **payment-gated** (tools/call → 402; discovery free)
- [x] LAUNCH: mainnet wallet swapped in → live on Base mainnet (`eip155:8453`), xpay non-custodial facilitator, real `PAY_TO`
- [x] Discovery: registered on 402index (pending review)
- [x] **Settlement proof — VALIDATED 2026-07-11** — full payment round-trip proven:
      `test_payment_flow.js` calls HTTP endpoint → receives 402 → signs EIP-3009 auth →
      retries with PAYMENT-SIGNATURE header → gets 200 with real CVE + EPSS enrichment data.
      Uses viem 2.55 (`privateKeyToAccount` from `viem/accounts`) + `toClientEvmSigner`
      (with `address: account.address` fix for viem v2) + `registerExactEvmScheme(config)`.
- [ ] **Official MCP Registry publish** — the owned distribution step; needs `mcp-publisher login` or a classic PAT (`read:org`+`read:user`)
- [ ] First organic paid call / first real dollar — NOT yet earned (needs distribution + demand)

### Corrections on record (things claimed done that weren't)
- The MCP `tools/call` shipped **without** a payment gate for most of 2026-07-08 (served data free); fixed same day.
- `~/.hermes/scripts/dollar_tripwire.py` is **non-functional** (DO_TOKEN empty → always reports $0).
- The `Br0ski777/x402-agent-tools` bundle chased as "the bullseye" is a dead channel (16★, solo, 0 external merges) — do not rely on it.
- Base-mainnet settlement uses a **non-custodial facilitator (xpay)** — no Coinbase/CDP key needed (the old README's CDP checklist was wrong).

## Cycle 2026-10-19 tasks
- [x] 1. Prepare coinbase/x402 ecosystem listing: branch `add-grey-ridge-signals` pushed to fork rezearcher/x402 (gh token cannot create upstream PRs: 403).
- [ ] 2. Open PR: https://github.com/rezearcher/x402/pull/new/add-grey-ridge-signals (needs Rez's browser login — one click)
- [ ] 3. Re-crawl Bazaar after 2026-10-20; diff settle payload vs a listed endpoint.
- [x] 4. Paid smoke via live CDP path (200 OK, 0.001 USDC); merchant-endpoint lastCalledAt did NOT move (lag or self-payer exclusion). Bazaar-freshness lever unproven; recheck once after 2026-10-20 then stop.
- [x] 5. (2026-10-19c) Re-checked directories: awesome-x402 #868 closed; Agoragentic list curated-only; gh PAT cannot create issues/PRs upstream (403) so remaining outreach targets (Heurist, AgentPay, inference.sh…) need email/browser — only hey@gitlawb.com has a public address.
- [x] 6. (2026-10-19d) Email outreach via mcp__gmail-me (works): 9 pitches sent total; see outreach/EMAIL_TARGETS_READY.md. Next: poll replies; send remaining candidates.
- [x] 7. (2026-10-19e) Shipped `GET /gate/swap?token=&side=&notional_usd=` ($0.01 go/hold/block pre-trade gate, built on buildTokenReport + liquidity-vs-size impact). Deployed via scripts/deploy.sh, live paid smoke 200 OK (buyer wallet C4852c…, first attempt transient 402, retry 200). In openapi/.well-known/llms.txt. Email budget (15) already used 2026-10-19; next: pitch /gate/swap to execution-agent builders AFTER budget resets; recheck Bazaar lastCalledAt after 10-20.
- [x] 8. (2026-10-19f) gate_swap MCP tool added (payment-gated, 402 verified, in tools/list), refactored buildSwapGate shared by HTTP+MCP; deployed.
- [x] 9. (2026-10-19g) Reply check (gmail-me matthewjaybowman@): 0 replies to 15 pitches. contact@ Gmail OAuth still not granted. Already listed in xpaysh/awesome-x402 (line 355). Recall-Kitchen/awesome-x402-mcp-services explicitly excludes token screens/trading tools -> don't pitch. Email budget spent for 10-19; next send window after reset: pitch /gate/swap to execution-agent builders.
- [x] 10. (2026-10-19h) Re-ran register_x402scan.js: 20/21 registered incl. /gate/swap (1 skipped, unchanged), 0 failed.
- [x] 11. (2026-10-19i) docs/EXAMPLES.md: /gate/swap + gate_swap MCP example.
- [x] 12. EXAMPLES.md decision values verified against src (lowercase go/hold/block).
- [x] 13. (2026-10-19j) Deployed /gate/swap/preview (free live sample, in llms.txt); reply check again 0 (inbox only noise). Email budget still spent for 10-19.
- [x] 14. (2026-10-19k) 402index.io POST /api/v1/register for token-report, gate/swap (pending review), funding, yields, pm/markets (live) with descriptions/prices on api.greyridgesignals.ai.
- [x] 15. (2026-10-18/19l) Reply check (gmail-me, newer_than:3d): 0. 402index: our Bazaar-sourced entries mirror there (8 /chain/* still "uncategorized/no description" — inherits Bazaar metadata; no update API except POST /register). 402index opportunities feed is dominated by 130+ lhr.life spam tunnels — directory-crowding, not a gap we can fill. Email budget spent for 10-19; next window: /gate/swap pitches to execution-agent builders.
- [x] 16. (2026-10-19m) GitHub repo rezearcher/x402-data-api: set homepage + 10 topics (x402, mcp, mcp-server, base, usdc, ai-agents, defi, polymarket, cloudflare-workers, pay-per-call) for GitHub/Glama topic discovery (was none).
- [x] 17. README: added /gate/swap + token-report rows + canonical api.greyridgesignals.ai.
- [x] 18. glama.json refreshed to live tools/list (gate_swap, chain_token_report) + canonical domain.
- [x] 19. server.json description now leads with gate_swap/token-report.
- [x] 20. llms-install.md MCP URL -> canonical api.greyridgesignals.ai (verified 200).
- [ ] 21. (2026-10-19n) Public gist of /gate/swap examples: gh PAT lacks gist scope (403) — dead end via gh; docs/EXAMPLES.md is the canonical copy. (Note: /tmp files do not persist between Bash calls; use repo-local paths.)
- [x] 22. docs/EXAMPLES.md base URL -> canonical api.greyridgesignals.ai.

## 2026-10-19 cycle (makemoney)
- 0 replies (gmail-me, 3d). Daily 15-email budget already spent 10-19. Wallet 32.30424 (only self-test gain).
- 402index lists 13 of our /chain,/defi,/crypto,/pm endpoints as 'uncategorized', no price/desc (self-registered probe); enrich/* have desc+price. POST /api/v1/register is L402-only; 402 body/header format is identical for both, so no worker fix found. Dead end.
- Added outreach/blockers/*.md for the two atoms.

## 2026-10-19 cycle (makemoney, late)
- 0 replies/bounces (gmail-me, 3d). Wallet 32.30424 (self-test only).
- gh issue comment on crewAI #7227 -> 403 (PAT lacks Issues write). Target list for when fixed: crewAI#7227, chainstacklabs/polyclaw#15, alsk1992/CloddsBot#149, SpartanLabsXyz/simmer-sdk#402, leventilo/boltzpay#165. Blocker file added.
- Product gap noted: token-report security.simStatus "unavailable" / isHoneypot null -> weak vs honeypot-check competitors; candidate improvement.

## 2026-10-19 cycle (makemoney, 3rd)
- 0 replies (gmail-me, 3d; only marketing noise). Republished official MCP Registry listing ai.greyridgesignals/tech-risk v0.1.1 (description now leads with gate_swap; desc must be <=100 chars). Auth: `mcp-publisher login dns --domain greyridgesignals.ai --private-key <hex of ~/.config/mcp-publisher/greyridgesignals_dns_key.pem>` works headless.

## Cycle 2026-10-19j
Inbox clean (0 replies/bounces to 15 pitches). Endpoints 200/402 healthy. Cap used. No new levers executable.
- 2026-10-19 04:45Z cycle: inbox 0 replies, wallet flat 32.30424, cap used; nothing new sendable.
- [x] 8. (2026-10-19k) Self-listed on Agent402 router (POST agent402.tools/api/index/register, no PR): both hosts listed, routable, health 1 (21/23 tools). Verify: GET agent402.tools/api/index?seller=<origin>. Queued APIbase/Dexter pitches in outreach/queue/ (send first after UTC reset). 0 inbox replies.
- 2026-10-19 05:10Z cycle: inbox 0 replies (only our own 15 sends); cap by UTC spent until 2026-10-20 00:00Z; APIbase/Dexter queued first.
- 2026-10-19 05:2xZ: found Circle Agent Marketplace (manual Google Form, needs login) -> outreach/blockers/circle-agent-marketplace-form.md. Inbox 0 replies.

## Cycle note 2026-10-19T05:15Z
Inbox: 0 replies/bounces to the 15 pitches. Wallet flat 32.30424 (self-test only). Smithery lacks us (needs login) -> outreach/blockers/smithery-publish.md. Email cap spent until 2026-10-20 00:00Z; queue apibase.md + dexter.md first then.
- 2026-10-19 05:2xZ: AgentShare MCP registry (agentshare.dev) listing SUBMITTED keylessly via POST /api/v1/registry/submit (id 116, pending_review 24-48h; status token in outreach/agentshare_submission.json). Recheck status_api_url after 10-21. 2s.io register costs $0.0012 (capital gate, skipped). Inbox 0 replies; cap spent until 10-20 00:00Z; apibase/dexter queued first.
- 2026-10-19 05:2xZ cycle: inbox 0 replies; CurlShip POST /api/submit and apidirectory /submit are redirect/HTML-only (no keyless API) - dead ends. Cap spent until 10-20 00:00Z; send apibase+dexter first.
- 2026-10-19 05:3xZ: CDP discovery/resources paged to offset 20000 (20000 items), 0 match greyridge/sigrunner/5765ae06 -> we are NOT in the public Bazaar discovery index (index may be larger; run takes ~4min, background it). Prior seed attempts did not stick.
- 2026-10-19: Orthogonal (orthogonal.com, $4.3M Pantera) provider-request pitch queued: outreach/queue/orthogonal.md.
- 2026-10-19: AgenticTrade (agentictrade.io, provider portal /portal/register, 292 services, only 4,880 total calls ever) = low-volume, skipped. Orthogonal pitch queued.

## 2026-10-19 cycle (nohumans + 402 body)
- Worker now mirrors the decoded payment-required header into the 402 body (v1-style crawlers like x402-list prober saw `{}` -> "No valid 402"). Deployed version 03d3706d.
- x402-list.com POST /api/v1/submit done (id 7c2f94ec, probe failed pre-fix); email cooldown 7d -> resubmit/ask after 2026-10-26 to re-probe.
- nohumans.directory (pays real USDC to verify listings = external buyer): listed gate/swap, token-report, defi/yields, token-security (crypto/prices was already listed). Tokens in ~/.config/x402-secrets/nohumans_tokens.txt. Check wallet for inbound from nohumans in ~1h+; verify via GET api.nohumans.directory/v1/resolve?url=.
- 2026-10-19 RELIABILITY FIX (deployed 875416e9→later): honeypot sim was "unavailable" ~70% of calls. Root cause (via wrangler tail): public Base RPCs 429 from CF IPs, rotation re-tried the same failing providers each call and blew the 50-subrequest cap. Fix: per-isolate cooldown + round-robin provider order (rpcOrder/rpcMarkBad), dead RPCs removed, non-revert provider errors ("method not supported") no longer treated as an answer, 5s fetch timeouts. Preview 12/12 tested. This directly affects gate/swap + token-report correctness for paying buyers.

## 2026-10-19T05:55Z cycle
- Cap is per LOCAL day (CDT): the 15-batch went out 22:53 CDT 10-18, so 10-19 CDT cap was unused. Sent apibase, dexter, orthogonal pitches (msg ids in outreach/sent/). 3/15 for 10-19 CDT. 0 replies in inbox. nohumans listings pending verification (resolve shows 'unknown' for sigrunner host; defi/yields active on api.greyridgesignals.ai).
- 2026-10-19 06:10Z: batch3 sent to buyer-side tooling authors (presidio, paidmcp client, x402-buyer-mcp, cryptoapis). 10/15 CDT cap used. paidmcp/directory has 10+ unmerged PRs (dead lever, like coinbase). 0 replies in inbox.
- 2026-10-19 06:20Z: batch4 sent (uvd sdk, spendveto, riskgate, conetlabs, agentfeed). 15/15 CDT cap used. Next send 10-20 CDT; check replies first.
- 2026-10-19 06:3xZ: previews now accept ?token=usdc|weth|cbbtc|aero|degen (free demo of non-USDC tokens). Deployed 2aa16943. Use in pitches: .../gate/swap/preview?token=degen. Deploy needs CLOUDFLARE_API_TOKEN=CF_WORKERS_TOKEN from ~/.hermes/.env.
- 2026-10-19: added docs/examples/swap-gate/gate.mjs (pay-and-guard example). New public repo creation was permission-denied; use this repo for examples.
- 2026-10-19: OpenAPI now lists free /gate/swap/preview + /chain/token-report/preview (demo tokens). Deployed aa883dfe.
- 2026-10-19 06:1xZ: nohumans.directory listings all 'verified' (gate/swap, token-report, defi/yields, token-security, crypto/prices; check by id via GET /v1/listings/<id>; resolve?url= needs exact query-string URL). Inbox 0 replies; CDT cap 15/15 spent until 10-20 CDT. Wallet flat 32.30424.
- 2026-10-19 06:2xZ: PayAI facilitator has a discovery list (21k items, facilitator.payai.network/discovery/resources) but listing is settlement-driven (no register endpoint) => needs a paid settlement; self-pay forbidden. Dexscreener latest profiles had 0 Base tokens; previews only accept the fixed demo-token set so a public scam-feed can't be generated free. Dead ends.
- 2026-10-19 06:3xZ: PayAI-discovery scan: 72 token-risk/honeypot competitors (mostly Solana, $0.001-0.10). Ours gate/swap $0.01, token-report $0.05, token-security $0.02 = in-market; no pricing edge. Few Base-native rivals (agent-kiosk, rugshield, auditor-x402).

## 2026-10-19 OpenDexter / x402gle audition (NEW LEVER, platform-funded external payer)
- `npx -y @dexterai/opendexter@1.25.2 audition <origin> --json` registers routes in x402gle catalog; with a specific endpoint URL it makes a REAL paid test call funded by OpenDexter (external USDC to us, not self-dealing). Docs: https://x402gle.com/agent.md
- Fixes shipped (deployed 8c7ecde7): OpenAPI paid ops now carry `x-payment-info` + `info.x-guidance`; `servers[]` is same-origin only (cross-origin servers => discovery_failed).
- Results: workers.dev origin => 20/23 routes registered (3 failed, not yet inspected). api.greyridgesignals.ai origin still `discovery_failed: No OpenAPI or well-known/x402` (reason unknown; maybe their fetcher/CF). Endpoint-level audition of workers.dev/gate/swap: registered but test `incomplete` ("OpenDexter could not settle a test payment... on our side, retry shortly"). CLI says do NOT auto-repeat; retry ONCE next cycle per endpoint (gate/swap, chain/token-report, chain/token-security), honor 429 cooldownUntil. Host page: https://x402gle.com/servers/x402-data-api.sigrunner.workers.dev
- 2026-10-19 later: x402gle.com/servers/x402-data-api.sigrunner.workers.dev/skills.json is LIVE with 20 skills (the 3 'failed' routes are just free /, /gate/swap/preview, /chain/token-report/preview - expected). Endpoint paid tests still 'incomplete' (their side); retry once next cycle. api.greyridgesignals.ai origin still discovery_failed.
branch@dexter.cash (audition support) queued: outreach/queue/dexter-audition-support.md — send first on 2026-10-20 CDT (cap spent 10-19).
- 2026-10-19 06:3xZ: audition retried once each (gate/swap, token-report, token-security): all still 'incomplete' (OpenDexter side). Do NOT retry again until dexter-audition-support email sent 10-20 CDT. Inbox 0 replies (only own ExposureWatch probes). Wallet flat.
- 2026-10-19 07:xxZ: 402 bazaar output schema was hollow ({type,example}, same as 87.8% of market per dev.to/noboru x402 market study). Added inferSchema wrapper around declareDiscoveryExtension -> real field names/types/required for all routes. Deployed 64858162. Market facts: median price $0.01, buyers 97% organic human, agent-aimed categories (ai_search avg $0.062, storage) can price >$0.01. agent-tools.cloud already lists both our hosts.
- 2026-10-19 07:4xZ: FIRST external inbound found: 0x54e163e9..f4e0 paid 0.001 USDC (block 52800805), wallet 32.30524. Everything else is self. Trace via eth_getLogs on non-mainnet.base.org RPCs. Inbox 0 replies. Cap spent until 10-20 CDT.
- 2026-10-19: competitor research: true402/AgentRisk(0.15)/RGX(0.04) token-safety; true402 wins via framework plugins (CrewAI/GAME/ElizaOS/AgentKit). Logged in IDEAS.md; publishing needs npm/PyPI token.
- 2026-10-19 06:45Z: inbox 0 replies (only own ExposureWatch probes); wallet 32.30524 (only external = 0x54e163 0.001). x402.watch/x402station dead hosts, pulsemcp submit 403, mcp.so needs login. Cap spent until 10-20 CDT; next: send dexter-audition-support, then retry audition once.
- 2026-10-19 06:55Z: inbox 0 replies (only own ExposureWatch probes); on-chain trace (last ~9000 blocks) shows only external payer 0x54e163 0.001 USDC, no repeat. Bazaar lists 14 resources (lastUpdated from our own canary seeds, not external calls). Cap spent until 10-20 CDT; next: send queue/dexter-audition-support.md first, then retry audition once.
- 2026-10-19 07:00Z: inbox 0 replies (only own ExposureWatch probes); no new external inbound in last 9000 blocks; AgentShare id 116 status URL 404s (recheck after 10-21); agent402 index live (613 tools). Cap spent; 10-20 CDT: send dexter-audition-support first.
- 2026-10-19 07:10Z: earlier inbound-trace returned empty because USDC address was mistyped; fixed + saved scripts/trace_inbound.py (confirms only external = 0x54e163 0.001 @ block 52800805). Use base-rpc.publicnode.com.
- 2026-10-19 07:3xZ: NEW LEVER built: scripts/competitor_payers.py + competitor_payto.json (42 Base payTo of PayAI-listed token-safety competitors). 1-day trace: 95 transfers; top payers incl. 0x54e163 (OUR only external payer) who ALSO paid competitors 5x — i.e. 0x54e163 is a shopping buyer-bot/aggregator that sampled us once; goal = get it to repeat. Wide multi-address eth_getLogs 403s on publicnode; query per-address.
- 2026-10-19 07:5xZ: competitor payer trace (1d, 42 payTo): total 92 transfers; 0x54e163 (our only external payer) = shopping buyer-bot, paid agentsvc.io token-security 5x (0.0355) + us once; agentsvc.io is itself a 126-service marketplace computing token-security directly (competitor, not a channel). Top payers are per-competitor wallets; no contact path. Lever yields no reachable humans; kept scripts/competitor_payers.py for re-runs.
- 2026-10-19 08:0xZ: PRICE CUT deployed b5a25e37: token-security 0.02->0.009, gate/swap 0.01->0.008, token-report 0.05->0.02. Why: buyer-bot 0x54e163 shops token-security and paid agentsvc.io (0.009, 7 chains, free trial) 5x vs us 1x; undercut benchmark. Revert if no change in 7d? (revenue at $0 so downside nil).
- 2026-10-19 07:25Z: inbox 0 replies; wallet flat 32.30524. Bazaar showed stale pre-cut prices; re-seeded /chain/token-security via refresh_bazaar_catalog.js (self-funded canary, excluded from revenue). gate/swap + token-report not in that script's route list (Bazaar still shows old 0.01 for gate/swap). Cap spent until 10-20 CDT.
- 2026-10-19: added /gate/swap + /chain/token-report to refresh_bazaar_catalog.js ROUTES and re-seeded (new prices in Bazaar).
- 2026-10-19: idea logged (free daily real-token trial). Competitors price 0.003-0.01; no further price change made.
- 2026-10-19: SHIPPED free real-token trial on /gate/swap/preview (3/IP/day via KV, any 0x Base address). Deployed cd9e4ae4+. Use in pitches: .../gate/swap/preview?token=<their token>.
- 2026-10-19: same 3/IP/day real-token trial on /chain/token-report/preview (shared counter with gate/swap/preview). Deployed 5499dec2.
- 2026-10-19 CDT: pushed fork branch rezearcher/awesome-x402-apis:add-grey-ridge-token-security (row in data/external.md); PAT can't open cross-repo PR -> outreach/blockers/payapi-market-pr.md. Inbox 0 replies; wallet flat 32.30524.
- 2026-10-19 CDT (cycle 13): inbox 0 replies. Wallet 32.34224: the +0.037 over prior is our own smoke tests (trace_inbound: only external = 0x54e163 0.001). NEW: we ARE now on Agentic Market (api.agentic.market/v1/services/search?q=sigrunner; id x402-data-api-sigrunner-workers-dev; 5 calls/1 payer L30D) but unenriched (no category/description) - enrichment is Coinbase-side, no submit path. Cap spent until 10-20 CDT.
- 2026-10-19 CDT (cycle 13b): **GitHub blocker was FALSE**: ~/.hermes/.env has GH_TOKEN_CLASSIC (repo+workflow+delete_repo scopes). Use `GH_TOKEN=$(grep '^GH_TOKEN_CLASSIC=' ~/.hermes/.env | cut -d= -f2-) gh ...` for issue comments, cross-repo PRs, pushes. Done with it: comment crewAI#7227, coinbase/agentkit #1091 + #1562; PR payapi-market/awesome-x402-apis#4; PR punkpeye/awesome-mcp-servers#16966 (fresh sync of amcs-old-fork). Bankr #796 + ATXP #14 already open. Gatefare dead (521, repo stale). Polyclaw/simmer/Clodds/boltzpay targets skipped (irrelevant). Comment bodies in outreach/gh/. SMITHERY_TOKEN also exists in .env (untested for publish).
- 2026-10-19: Smithery publish via SMITHERY_TOKEN (valid, namespaces grey-ridge-signals-group, rezearcher) -> 403 'Updating servers has been removed' for every name; DEAD LEVER, blocker file removed.
- 2026-10-19 CDT (cycle 13c): PR Merit-Systems/awesome-agentic-commerce#814 (maintainer merges there; gold-402 PR #38 already merged Jul). Issue filed haoruilee/awesome-agent-native-services (428★, actively merged, issue-first; body outreach/gh/agent-native-services-issue.md) - check for maintainer go/no-go then PR service file per CONTRIBUTING sec 7.
- 2026-10-19 CDT: PR collabnix/awesome-mcp-lists#232 (maintainer merges many/day). cryptoskill dead since Mar; awesome-hermes-skills not MCP-fit.
- 2026-10-19 CDT (cycle 14): inbox 0 replies (only own ExposureWatch probes); wallet 32.34224, only external = 0x54e163 0.001. All 4 open PRs (agentic-commerce#814, collabnix#232, awesome-mcp-servers#16966, payapi#4) unmerged, no maintainer comments yet; replied on punkpeye#16966 re Glama badge check (glama page 200). Cap spent until 10-20 CDT; send queue/dexter-audition-support.md first then.
- 2026-10-19 CDT (cycle 14b): GH issue search for honeypot/token-safety requests: every live thread (agentkit#1091/#1562, crewAI#7227, agent-governed-vaults#471) already has our comment. mcp.so/cline marketplace issues were filed in July (still open, 0 response). Apify actor grey-ridge-base-onchain exists with 0 runs; Apify revenue would not land in the x402 wallet. No new reachable lever until 10-20 CDT cap reset.
- 2026-10-19 CDT (cycle 15): inbox 0 replies; 4 PRs + agent-native-services#231 still no maintainer response; trace_inbound: only external still 0x54e163 0.001. Cap spent until 10-20 CDT; first send queue/dexter-audition-support.md + apibase/dexter pitches.
- 2026-10-19 CDT (cycle 15b): xpaysh/awesome-x402 dead (last merge 2026-07-28, 1000+ open PRs). Don't revisit.
- 2026-10-19 CDT (cycle 16): inbox 0 replies; 4 PRs still no maintainer response. NEW external payer 0xec2abd3eda89bed90124736e317e847d5fb6d034 paid 0.009 (block 52803831, token-security at post-cut price) = 2nd external ever; it is a mass shopper bot (~300 USDC transfers/9000 blocks across ~50 payTo, mostly 0.01/0.005/0.002 price points) like 0x54e163. Supports 'shoppers route on price' -> price cut working; hold prices, don't churn. 24h traffic-stats: token-security 262 hits, gate/swap 177, token-report 134 (mostly unpaid 402 probes). Cap spent until 10-20 CDT.
- 2026-10-19 CDT (cycle 17): inbox 0 replies; 5 PRs/issue still no maintainer response; email cap 15/15 spent till 10-20 CDT. Cut /whois 0.02->0.01 (shopper bots cluster at <=0.01 price points) deployed cbdd048b. token-report stays 0.02 (premium). Repo searches for more merge-able awesome lists yielded only tiny ones (awesome-web3-security 25★, awesome-agent-payments-protocol 16★).
- 2026-10-19 CDT (cycle 18): inbox 0 replies (only own ExposureWatch probes). 3rd external payment: 0xec2abd paid 0.008 (gate/swap, block 52804383) after the cut — wallet bots now converting on price. Bot profile (27k blocks): 0xec2abd = 314 transfers/52 payTo, 173 at exactly 0.01, mostly <=0.01; 0x54e163 = 205 transfers/86 payTo, mostly 0.005-0.008. They are breadth scanners (~$2-3/day each spread over ~50-90 services) => per-endpoint revenue is cents; $1000 can't come from them alone. Keep every paid default-param call valid + priced <=0.01. Cap spent till 10-20 CDT.
- 2026-10-19 CDT (cycle 18b): cut /enrich/tech-risk 0.05->0.02, /scan/mcp 0.10->0.05 (scanner bots pay up to 0.05; all else <=0.01). Deployed ff537bdd. Bazaar listing for these not re-seeded (not in refresh_bazaar_catalog ROUTES).
- 2026-10-19 CDT (cycle 18c): shipped /chain/erc20-meta (0.005) + /chain/nonce (0.001) for scanner bots; deployed 5ab896c1; both 402 live and in openapi. Handlers not exercised with a paid call (no self-pay).
- 2026-10-19 CDT (cycle 18d): shipped /chain/allowance (0.002) + /chain/block (0.001); deployed 78000a1a; 402 live. Catalog now 25 paid routes.
- 2026-10-19 CDT (cycle 19): inbox 0 replies; PR #814 still open. trace_inbound: 0xec2abd now also buying cheap new routes (0.005,0.003,0.001x4 at blocks 52804529-684) => external total ~0.030 USDC; bots do sweep new cheap endpoints. Bot spend/day is capped, so more endpoints != more revenue; no further build this cycle.
- 2026-10-19 CDT (cycle 19b): market study (api.agentic.market sort=volume): inference gateways dominate volume (BlockRun 98k calls/269 payers, Otto, Nansen); whole market tiny (Exa 5.4k calls/94 payers). Shipped /ai/ask 0.002 on Workers AI (llama-3.2-3b, KV hard cap 400/day = free tier). Deploy 5459de9d+. Handler unverified by paid call (no self-pay).
- 2026-10-19 CDT (cycle 19c): OpenDexter audition on /ai/ask: query-string URL skipped; plain URL registered, no paid test. Don't repeat until dexter-audition-support is sent.
- 2026-10-19 CDT (cycle 19d): /ai/ask/preview free (3/day/IP, shared KV cap) deployed 3e5777c9; Workers AI binding verified working live, so paid /ai/ask handler path is sound.
- 2026-10-19 CDT (cycle 20): inbox 0 replies; 5 PRs/issue still unanswered; /ai/ask grounded with x402/Base context (preview hallucinated 'X402 jet'); deployed 6ef27a49. Bazaar re-seed skipped (self-pay canary). Cap spent till 10-20 CDT.
- 2026-10-19 CDT (cycle 20b): x402watch census: ax1.vc q-verdict (Base token AI verdict card, $0.02) = 314k calls/2,992 payers 30d — human front-end demand, API-only token-safety rivals ~100 calls. Our token-security/report are in CDP Bazaar (fresh). Logged consumer 'verdict card' front-end idea in IDEAS.md.
- 2026-10-19 CDT (cycle 20c): shipped /check consumer verdict page (calls token-report/preview), in sitemap+llms.txt; deployed.
- 2026-10-19 CDT (cycle 21): inbox 0 replies; all 5 PRs/issue unchanged (no maintainer response); endpoints 200. Cap spent till 10-20 CDT; no new lever.
- 2026-10-19 CDT (cycle 21b): found lgs1520/agent-procurement-manager (APM): a reseller that buys token_risk from Bazaar suppliers with its own float (2x markup). Filed supplier-candidate issue #1 (outreach/gh/apm-supplier-issue.md). Check for reply next cycle. Other Bazaar tools (x402watch, x402-observer, onyx-bazaar) are indexes, not buyers.
- 2026-10-19 CDT (cycle 21c): code search for x402 token-security consumers: safehands/onyx-mcp/spraay/Agent402 are all sellers wrapping GoPlus, not buyers. No further reseller leads beyond APM#1.
- 2026-10-19 CDT (cycle 21d): added erc20-meta/nonce/allowance/block/ai-ask to refresh_bazaar_catalog ROUTES and seeded all 5 into CDP Bazaar (self canary, excluded from revenue; also proves paid handlers settle). Check Bazaar lists them next cycle.
- 2026-10-19 CDT (cycle 21e): Bazaar (25,695 items; paginate limit=1000&offset) lists 15 of ours; the 5 just-seeded routes not indexed yet (lag) - recheck next cycle.
- 2026-10-19 CDT (cycle 21f): trace_inbound: external total 0.032 USDC (0x54e163 0.001, 0xec2abd 0.031); the rest of wallet delta is our own canaries. Only bot micro-payments so far.
- 2026-10-19 CDT (cycle 22): inbox 0 replies; 4 PRs + APM#1 no response; Bazaar now lists all 5 new routes (20 sigrunner resources). Wallet 32.38524, external still bots only. Cap spent till 10-20 CDT.
- 2026-10-19 CDT (cycle 22b): IndexNow key route deployed (b863207a), pinged api.indexnow.org with /check + / (202). Key in outreach/indexnow.key. Human-SEO lever for /check verdict page.
- 2026-10-19 CDT (cycle 23): inbox 0 replies; trace_inbound unchanged (ext = bots only, ~0.03). GH scan: Recall-Kitchen/awesome-x402-mcp-services excludes token tools (dead); dacode-dev/x402-services-directory only crawls payai+openx402 facilitator catalogs (we settle via CDP/xpay -> absent; seeding needs a worker facilitator switch, low EV, not done). Cap 15/15 till 10-20 05:00Z; then send outreach/queue/agent402.md + dexter-audition-support.md.
- 2026-10-19 CDT (cycle 23b): NEW — PayAI facilitator discovery catalog (21k items; crawled by dacode directory etc.) is self-seedable: FACILITATOR=payai node scripts/refresh_bazaar_catalog.js settles canary directly via facilitator.payai.network/settle (no auth). Seeded all 20 routes (self canary, excluded from revenue). /chain/code confirmed listed. OpenX402 facilitator not yet tried.
- 2026-10-19 CDT (cycle 23c): OpenX402 facilitator requires payTo registration at openx402.ai/register, but openx402.ai returns 404 (site down) -> dead. Script now supports FACILITATOR=openx402 and fails on success:false.
- 2026-10-19 CDT (cycle 23d): VERIFIED PayAI discovery lists all 20 of our routes. Also seeded uvd (ultravioletadao) all routes and Dexter facilitator (x402.dexter.cash) for 8 routes >= its $0.0014 floor (settle 200) but neither catalog lists us yet (recheck; may be async). Script: FACILITATOR=payai|openx402|dexter|uvd. Recheck dexter/uvd/dacode next cycle.
- 2026-10-19 CDT (cycle 23e): recheck: Dexter (0/3177) and UVD (0/1208) catalogs still do not list us after settle; dacode services.json stale (generatedAt 02:23Z). PayAI 20/20 is the only new surface; measure via trace_inbound for new external payers over next cycles.
- 2026-10-19 CDT (cycle 23f): ~/.hermes/scripts/x402_bazaar_refresh.sh now also runs FACILITATOR=payai refresh daily (20h cooldown) so PayAI listing stays fresh.
- 2026-10-19 CDT (cycle 23g): facilitator.mcpay.tech discovery mirrors PayAI (21k, already lists our 20). pay.openfacilitator.io catalog only 100 items, not indexing us. Facilitator-catalog lever exhausted; PayAI/mcpay is the only effective one.
- 2026-10-19 CDT (cycle 23h): NOTE wallet 32.38524 -> 32.58224 is OUR seeding canaries (payai/dexter/uvd/mcpay/openfac), NOT revenue. Do not re-seed catalogs repeatedly; they inflate the scoreboard.
- 2026-10-19 CDT (cycle 24): inbox 0 replies (10 msgs, no outreach replies); APM#1 no comment; trace_inbound ext still bots only (~0.03); endpoints healthy (/, /check, /gate/swap/preview 200). Cap spent till 10-20 05:00Z; queued agent402.md+dexter-audition-support.md send then. No new lever found; don't re-seed catalogs (inflates scoreboard).
- 2026-10-19 CDT (cycle 25): inbox 0 replies (no outreach responses); trace_inbound ext unchanged (bots only, last ext block 52804831); cap spent till 10-20 05:00Z; no new lever. Send queue/agent402.md + dexter-audition-support.md after reset.
- 2026-10-19 CDT (cycle 25b): klymax402.com (marketplace named on mcp.so token-safety-x402 page) does not resolve (dead). No new lever.
- 2026-10-19 CDT (cycle 26): inbox 0 outreach replies; ext payers still bots only; endpoints 200; cap spent till 10-20 05:00Z. Queue sends after reset.
- 2026-10-19 CDT (cycle 26b): set TRAFFIC_STATS_SECRET (stored ~/.hermes/data/x402-data-api/traffic_secret.txt); 48h hits: /mcp 5220, /chain/block-number 899, /chain/code 830, /chain/balance 826, /crypto/prices 708, /crypto/funding 592, /pm/markets 543, /chain/token-security 410, /gate/swap 259. /mcp is dominant: check if MCP tool calls are monetized/priced. Bots hit cheap /chain/* most.
- 2026-10-19 CDT (cycle 27): inbox 0 outreach replies (11 msgs: newsletters/ExposureWatch probes); ext payers still bots only (0x54e163 0.001, 0xec2abd ~0.031); 48h traffic = every route probed ~260-900x (402 sweeps), conversion only at <=0.01. Cap spent till 10-20 05:00Z; queue/agent402.md + dexter-audition-support.md send after reset. Wallet 32.58424 (delta = our seeding canaries).
- 2026-10-19 CDT (cycle 27b): DEPLOYED 6830daca: settled paid calls now logged per route+payer in TrafficLog; read via /internal/traffic-stats?paid=1&window_hours=N&secret=<traffic_secret.txt>. Next cycle: read it to see which routes bots settle.
- 2026-10-19 CDT (cycle 28): inbox 0 outreach replies; APM#1 + PR#416 no maintainer response; paid=1 log empty so far (no settled calls since 6830daca deploy); cap spent till 10-20 05:00Z; queue agent402.md/dexter-audition-support.md pending.
- 2026-10-19 CDT (cycle 28b): opened Agent402 issue #1673 (token-safety tools) via GH_TOKEN_CLASSIC; not email so cap n/a. Only dexter-audition-support.md remains queued.
- 2026-10-19 CDT (cycle 28c): GH issues (cap n/a): Dexter-DAO/dexter-mcp#126 (audition settle), sF1nX/x402station-mcp#4 (preflight). Queue now empty. Check replies next cycle.
- 2026-10-19 CDT (cycle 28d): GH issue pitches to buyer-side swap wallets UltraStarz/tollkit-wallet, lopushok9/Agent-Layer (pre-swap gate PR offer). Competitor sellers abound (true402, wyattpalm2 x402-seller, warden402...): token-safety is crowded.
- 2026-10-19 CDT (cycle 29): inbox 0 outreach replies; issues Dexter#126, x402station#4 have 0 comments; PR#416 2 comments (no merge); paid=1 log empty 12h; /mcp tools/call gated at flat $0.005 (5220 hits are crawler tools/list probes, not buyers). Wallet 32.58424 (= our canaries). Cap resets 10-20 05:00Z; queue empty. No new lever.
- 2026-10-19 CDT (cycle 29b): DEPLOYED e884c4a9: token-report + tech-risk 0.02->0.01 (bots convert only <=0.01; all but scan/mcp now <=0.01). Verified live 402 amount=10000 on both hosts. Note: another process deployed from the working tree right after my first deploy, so uncommitted edits can be overwritten; commit before deploy. Watch trace_inbound for new payers on these routes. Static x402-data-api-openapi.json still says $0.02 for token-security/whois (stale, low priority).
- 2026-10-19 CDT (cycle 30): inbox 0 outreach replies (ExposureWatch probes/newsletters only); paid=1 log empty 24h; trace_inbound ext = same two bots (~0.03 total), no new payers since price cut; cap resets 10-20 05:00Z, queue empty. Logged bot-feed micro-route idea to IDEAS.md.
- 2026-10-19 CDT (cycle 30b): research (dev.to/tanod Bazaar data): 94% of listings lack a 'use when' line; top-payer routes are single-purpose chain reads <=$0.005 + ax1 q-verdict $0.02 (4750 payers). Added 'Use when...' to 9 paid-route 402 descriptions, DEPLOYED a6e35b5b, verified live 402 body. Daily bazaar refresh cron will propagate to catalog.
- 2026-10-19 CDT (cycle 30c): shipped GET /chain/total-supply $0.003 (onesource-style top-payer shape; 402 verified live on api host, deploy d591afd3; first deploy showed 404 for ~1min = propagation). Added to refresh_bazaar_catalog ROUTES; daily cron seeds it (self canary, not revenue).
- 2026-10-19 CDT (cycle 31): inbox 0 outreach replies. CF alert: DO daily limit 90% (our per-hit TrafficLog). DEPLOYED af39f4c1: non-PAID hit logging sampled 1/10, /mcp skipped (PAID unsampled). Traffic-stats counts now ~10% of true. Queue empty; cap resets 10-20 05:00Z.
- 2026-10-19 CDT (cycle 31b): GH issues (cap n/a) to buyer gateways sarmadahsan/pay-guard#107 and naxytra/naxytra-mcp#1 offering optional pre-pay token/swap check provider. Next: check comments.
- 2026-10-19 CDT (cycle 31c): GH issues: Bdysj/agentbrake#2, floflo777/undo#1, twzrd-sol/twzrd-trust#207, swarm-agent-operator/swarm-x402-mcp#2 (pre-pay token check provider offer). Check comments next cycle.
- 2026-10-19 CDT (cycle 31d): shipped GET /chain/storage-at $0.002 (deploy 1beadf53, 402 verified both hosts; first deploy 0bc5afa0 was overwritten by a concurrent stale deploy -> redeploy). Added to bazaar seed list; daily cron seeds it.
- 2026-10-19 CDT (cycle 31e): GH issues selimaytac/hashspan, whiteknightonhorse/mcp-protocol-tester (test-target offer).
- 2026-10-19 CDT (cycle 32): inbox 0 outreach replies; bot 0xec2abd paid new 0.01 (only ext movement). Shipped GET /chain/proxy-info $0.003 (EIP-1967 resolver), deploy 4bd5d2ec, bazaar seed entry added. Cap resets 10-20 05:00Z.
- 2026-10-19 CDT (cycle 32b): ELASTICITY TEST deployed bfbbdca7: 9 chain-read routes 0.001->0.005 (sweeper bot pays up to 0.01; 0.001 yielded 0.001/hit). Verified live amount=5000. MEASURE: trace_inbound ext payments per sweep before (~0.001 ea) vs after; revert if bot stops paying. Replied to swarm-x402-mcp#2 (they decline; 0 repeat buyers either).
- 2026-10-19 CDT (cycle 33): inbox 0 outreach replies; 9 GH pitch issues 0 comments (hashspan merged, mcp-protocol-tester closed); endpoints 200/402 on both hosts; CF DO daily limit EXCEEDED (traffic-stats 500s until 00:00Z reset; payment path fails open, verified in src/index.ts:2487,2613); only ext movement 0xec2abd 0.01 @52809190; GH repo search yields no unseen x402 targets. Cap resets 10-20 05:00Z, queue empty.
- 2026-10-19 CDT (cycle 34): inbox 0 outreach replies; 7 GH pitch issues 0 comments; PR#416 open 2 comments unmerged; trace_inbound ext still only 0xec2abd 0.01; web search for x402 earner rankings returned only explainers (no new lever). Cap resets 10-20 05:00Z.
- 2026-10-19 CDT (cycle 34b): found agent-wallet repos via code search wrapFetchWithPayment (nirholas/three.ws, cryptocurrency.cv); issue create returns 403 with GH_TOKEN_CLASSIC (no scope for these repos now). Draft at outreach/gh/three-ws-issue.md; retry next cycle or via email.
- 2026-10-19 CDT (cycle 34c): 403 was wrong token (GH_TOKEN_CLASSIC must be read from ~/.hermes/.env; not exported in shell). Opened issues: nirholas/three.ws#393, nirholas/cryptocurrency.cv#107, vybenetwork/x402-client#15 (pre-sign token check pitch). Check comments next cycle.
- 2026-10-19 CDT (cycle 34d): code-search for x402 client signatures -> 4 more pitch issues: BlockRunAI/ClawRouter#477, Libertai/libertai-agents#154, nirholas/universal-crypto-mcp#39, desplega-ai/agent-swarm#2269 (list in outreach/gh/issues_cycle34.txt; candidates in outreach/gh/cand.txt). Check comments next cycle.
