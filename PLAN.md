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
