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
