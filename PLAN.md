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
