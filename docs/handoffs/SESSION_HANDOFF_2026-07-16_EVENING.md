# Session handoff — 2026-07-16 EVENING

**Project:** x402-data-api
**CWD:** /home/rez/projects/x402-data-api
**Branch:** main

---

## TL;DR

**Uncommitted work on disk: 5 new, 1 modified, 0 deleted.** 0 open PR(s).

## Why — Rez's intent & where we are

### 🎯 READ THIS FIRST — mission + the operating law
**Mission: make `x402-data-api` earn its FIRST REAL DOLLAR, fully autonomously.** It's a live,
x402-paid MCP **security scanner** on Base mainnet. **CORE OPERATING LAW (Rez, non-negotiable —
see Division memory `core-operating-law-improve-until-forced-dollar-no-second-path`):** there is
exactly ONE mode — **keep improving the product until it is so useful an agent has no recourse but
to pay.** No second path. No "wait for the market," no bounty/human-rail escape hatch, and NEVER
argue the goal is impossible or hand it back — that's the documented failure. Improve usefulness +
discoverability relentlessly until the dollar is forced. The revenue monitor flags it the instant
a real payment lands.

### What's BUILT + LIVE (deploy a0544cd2, worker ver ~312d4cb6+)
- Worker on Base mainnet, x402 micropayment gate via **non-custodial xpay** facilitator.
- **Moat SKU:** `scan_mcp_server` ($0.05) audits a target MCP server for tool-poisoning/prompt-
  injection/exfiltration (OWASP LLM01/LLM08). `scan_mcp_preview` (**FREE**) returns counts+risk
  only → forces payment for the itemized detail. Precise (DeepWiki scans clean; poisoned tool =
  CRITICAL). Plus `enrich_tech_risk`/`enrich_domain` (CVE/EPSS/KEV) tools.
- **Listed:** official MCP Registry + 402index (both active, domain-verified). x402 endpoints stay
  as free upside.
- **Autonomy live:** `x402_selfheal.py` (15-min cron, auto-redeploys known-good on gate regression)
  + `x402_revenue_monitor.py` (30-min on-chain first-dollar detector). Prospector systemd loop reads
  `~/.claude/prospector/STRATEGIC_DIRECTIVE.md` at SENSE.
- **$0 earned so far.** Payment rail PROVEN end-to-end (`test_payment_flow.js` settles real USDC).

### THE COMPUTE UPGRADE PLAN (the level-jump) — **`GCP_EXECUTED_SCAN_PLAN.md` (291 lines — read it)**
A CF Worker can't run real scan tooling (no subprocess) → today's scan is *static* description
analysis. The plan: **Worker stays a thin x402 gate; GCP Cloud Run runs REAL executed scans**
(garak/mcp-scan/nuclei) async. Paid call settles → dispatches job → returns `job_id` in <1s; the
agent polls the result **free**. Auth: OIDC Worker→GCP (jose+WebCrypto), HMAC webhook back. Sells
"fetch a URL you supply" so it's **SSRF-proxy-for-hire by default → VPC egress denies RFC1918 +
169.254 metadata IP, allowlist not blocklist**. Budget-capped → **~$0** on free tier. Build order:
**L3** (thin Worker + D1-driven config/pricing/rules — buildable NOW) → **L2** (Cloud Run backend,
on the GCP atom) → **L4** distribution → **L5** self-improving loop (D1 funnel auto-tunes rules/
pricing/distribution, wired into the prospector loop) → **L6** (new SKU = new `task_type` D1 row).

### KEYS — all added this session, live next ctx window (VERIFY, don't assume)
- **CF Worker secrets (encrypted, confirmed via `wrangler secret list`):** `CDP_API_KEY_ID` +
  `CDP_API_KEY_SECRET` ✓ — the Bazaar-discovery lever. Next session: wire the dual-facilitator code
  (route settlement through CDP so Coinbase Bazaar auto-lists us) + re-seed one payment. **CHECK the
  CDP key format** (older ID+secret vs newer key-name+PEM) and match `env.` reads accordingly.
- **`~/.hermes/.env` (0600):** `GH_TOKEN` (= classic `public_repo` PAT, fixed this session so `gh`
  picks it up), `SMITHERY_TOKEN`, `APIFY_TOKEN`, `RAPIDAPI_KEY`, `GCP_PROJECT_ID`,
  `GOOGLE_APPLICATION_CREDENTIALS` — all SET.
- **GOTCHA — GCP not fully wired:** gcloud has NO active account/project yet. First: `gcloud config
  set project "$GCP_PROJECT_ID"`, verify ADC works (`gcloud auth application-default print-access-token`),
  confirm **billing is enabled**, then `gcloud services enable run.googleapis.com
  artifactregistry.googleapis.com cloudtasks.googleapis.com`. After that, everything in the plan is
  scriptable — a flip, not a project.

### ▶️ START PROMPT (paste this next session to get back to 100 immediately)
```
Resume x402-data-api → FIRST DOLLAR. Read in order: docs/handoffs/SESSION_HANDOFF_2026-07-16_EVENING.md,
then GCP_EXECUTED_SCAN_PLAN.md, then ~/.claude/prospector/STRATEGIC_DIRECTIVE.md.
Operating law: ONE mode — improve the product until an agent has no recourse but to pay; never argue
the goal, never hand it back. All keys were added last session (verify first): CDP_API_KEY_ID/SECRET
are CF Worker secrets (`cd ~/projects/x402-data-api && export CLOUDFLARE_API_TOKEN=$(grep -m1 ^CF_WORKERS_TOKEN= ~/.hermes/.env|cut -d= -f2-) CLOUDFLARE_ACCOUNT_ID=$(grep -m1 ^CF_ACCOUNT_ID= ~/.hermes/.env|cut -d= -f2-) && npx wrangler secret list`); .env has GH_TOKEN(classic)/SMITHERY_TOKEN/APIFY_TOKEN/RAPIDAPI_KEY/GCP_PROJECT_ID/GOOGLE_APPLICATION_CREDENTIALS.
First moves, in order:
1. Health-check: run x402_selfheal.py + x402_revenue_monitor.py; confirm endpoints gated (preview free, scan paid 402).
2. GCP: gcloud config set project $GCP_PROJECT_ID; verify ADC + billing; enable run/artifactregistry/cloudtasks.
3. Build L3 (thin Worker + D1 config/pricing/rules) and stage the full L2 Cloud Run executed-scan backend per GCP_EXECUTED_SCAN_PLAN.md.
4. Wire the CDP dual-facilitator path (secrets already set), re-seed one settlement so the Coinbase Bazaar auto-lists us.
5. Fire distribution with the now-available tokens: Smithery + Apify listings, publish the public repo for PulseMCP/Glama crawl.
Keep improving usefulness + discoverability until the revenue monitor flags the first paid call.
```

## Uncommitted work on disk

Files in the working tree that are NOT yet captured in any commit. This is
usually where the session's most recent work lives. Capture or commit these
before clearing context.

**New (5):**
- .dev.vars.example
- GCP_EXECUTED_SCAN_PLAN.md
- docs/
- package-lock.json
- test_payment_flow.js

**Modified (1):**
- server.json

## Session activity (last 8 hours)

Files under `src/`, `scripts/`, `tests/`, `docs/`, `prompts/`, `systemd/`
modified within the last 8 hours. Approximates "what this session touched"
even when nothing's been committed yet.

src/index.ts

## In-flight work

### Unpushed commits

(none — all commits pushed)

### Recently merged

0eed0e3 scan: fix invisible-unicode false-positive (0-f range bug flagged all text HIGH); deepwiki now clean, poisoned still CRITICAL. deploy 312d4cb6
203f597 scan: freemium — free scan_mcp_preview (counts) → paid scan_mcp_server (detail). Forces payment to see WHICH/HOW. deploy 7666775c
f66cc73 known-good baseline: gated MCP + SSRF guards + scan_mcp_server moat SKU (deploy a0544cd2)

### Open PRs

(gh pr list failed)

## Active goal

(no /goal active — checked ~/.claude/goal-states/, ./.claude/, ~/.claude/projects/)

## Standing directives

- Division code is read-only unless Rez has explicitly approved edits in this session
- No success theater — never say "done" without BUILD+VERIFY evidence when Division is up
- Run BUILD subagents on `sonnet` or `haiku`; never inherit Opus from the orchestrator
- Surface undone work — never quietly skip a step
- For destructive or shared-system operations, confirm with Rez before acting
- Swarm checkpoint body: `outcome` + `directives` fields only; include `X-Project` header
- Auto-merge overnight-agent PRs by default; surface failures not successes

## Next-session plan

### Queue tail (last 10 entries)

- midas-adverse-selection-penalty-2026-05-30 [disabled]: options_pricing.synthetic_spread(): add is_adverse=False parameter; when True, s
- midas-wire-catalyst-window-days-2026-05-30 [disabled]: PositionMonitor.tick() at lines 132-135 says CatalystMonitor not yet built; it I
- midas-doc-cleanup-stale-counts-and-status-2026-05-30 [disabled]: Doc cleanup batch (architecture-drift findings): (1) ARCHITECTURE_GOALS.md:16 51
- midas-unify-gateway-log-naming-2026-05-30 [disabled]: M11_TRADE_LIFECYCLE_DESIGN.md uses gateway_decisions.jsonl. Code uses gate_accep
- midas-document-kelly-warmup-gap-2026-05-31 [disabled]: Add to docs/ARCHITECTURE_GOALS.md: 'Quarter-Kelly is pre-empirical until ≥50 clo
- midas-wire-production-callers-fail-closed-gates-2026-05-30 [disabled]: PR #106 shipped 4 fail-closed gate classes (KillSwitchFlag, StateMachineMode, Da
- midas-write-daily-balance-and-peak-equity-2026-05-26 [disabled]: BLOCKER from PR #120 paper-trading-readiness audit. Without a fix, the first pap
- midas-refreeze-stage0-baselines-cvna-calibration-2026-06-06 [disabled]: GOAL: Fix the CVNA/BBBY Stage-0 regression instability and clear the stale-basel
- fix-target-statuses-drift [failed]: In division/memory/entity_store.py the TARGET_STATUSES tuple (line ~27) omits 'h
- fix-ingest-purge-deleted-skills [failed]: division/skills/index.py ingest() is upsert-only (line ~226 client.upsert) — it 

### Recent Division memory (project conversation)

(Division MCP not available — start division server or set MCP_API_KEY in .env)

## Hard constraints

Division code is read-only unless explicitly authorized this session.
Run BUILD subagents on sonnet/haiku — never Opus.
Don't push to main without explicit approval.
No bounty submissions without Rez approval.
Stop and ask if scope, legality, or authorization is unclear.

## Inputs to read at session start

- This handoff doc itself
- `CLAUDE.md` (root) + project-level `CLAUDE.md` if present
- Any open PR linked above
- Pin board: `division/docs/DIVISION_PIN_BOARD.md` (if Division project)

## Trust + delegation defaults

- Auto-merge overnight-agent PRs (per `[[feedback_overnight_pr_approval_mode]]`)
- BUILD subagents on `sonnet` or `haiku`, NEVER Opus (per CLAUDE.md hard rule)
- Don't stop at chunk completion under active /goal — drain the queue (per `[[feedback_dont_stop_at_chunk_completion]]`)
- Swarm checkpoint schema: `outcome` + `directives`, X-Project header required (per `[[feedback_swarm_checkpoint_schema]]`)

---

*Generated by `/handoff` skill at 2026-07-16T21:07:18Z*
