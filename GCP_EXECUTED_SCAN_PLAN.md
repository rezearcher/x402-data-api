# x402-data-api → Executed Security Product — GCP Handoff Plan

**Status: committed architecture, ready to build.** This supersedes the "static-analysis-only"
ceiling recorded in `PLAN.md` and executes the pivot already logged in
`~/.claude/prospector/STRATEGIC_DIRECTIVE.md` ("sell executed offense, not cached free data").
Nothing here waits on further research — the four research passes that fed this doc agree on
architecture; the only open item is one GCP credential atom (below), and everything else is
buildable against this spec today.

**Grounded against the live repo, 2026-07-16:**
- `src/index.ts` — 1152 lines, monolithic Hono Worker. `PAY_TO`/`FACILITATOR_URL`/`NETWORK` are
  plaintext `[vars]` in `wrangler.toml` (not secrets — fix in L3). Prices hardcoded per-route in
  `makeRoutes()` (`$0.05` scan_mcp_server, `$0.10` GET variant, free preview).
  `analyzeMcpTool()` (line 892) = 5 hardcoded regex rules, weighted 40/20/8/3 → 0-100 score.
- No D1 binding exists yet. No GCP project exists yet — **`gcloud auth list` returns "No
  credentialed accounts," `gcloud config list` shows no project set.** This corrects the task
  framing: GCP is not "ADC present," it is an uninstalled backend. That's the one real atom.
- Prospector loop is live infra, not a plan: `~/.claude/scripts/prospector_routines.sh` (systemd
  timer) + `prospector_meta.py`, reading `~/.claude/prospector/{dead_channels.txt,
  meta_insights.md, STRATEGIC_DIRECTIVE.md}`, reconciling real paid calls via
  `check_paid_calls.sh` (on-chain Base RPC `eth_getLogs` scanner, currently wired only for the
  tech-risk price band). This plan extends that loop; it does not replace it.

---

## 1. THE ARCHITECTURE — the L2/L3 jump

```
Agent/buyer
   │  POST /mcp {tool: scan_mcp_server_deep, target_url}
   ▼
Cloudflare Worker (x402 gate)                              <1s, synchronous
   │  1. x402 payment challenge → verify/settle via xpay facilitator (unchanged, existing code)
   │  2. Free precheck: target must answer MCP tools/list — rejects non-MCP endpoints,
   │     internal IPs, and junk before we ever spend a paid job on it
   │  3. Idempotency check: settled tx hash as dedup key (D1) — replayed payment can't
   │     spawn a second job
   │  4. Mint a self-signed Google OIDC-shaped JWT (jose + WebCrypto RS256, no extra
   │     network hop) → POST to Cloud Run dispatcher, Authorization: Bearer <jwt>
   │  5. Write requests row (stage=paid_attempt) to D1
   │  6. Return HTTP 200 {job_id, status:"queued", poll_url} — same response body shape
   │     agents already parse, no 202+Location convention to hope the caller supports
   ▼
Cloud Run "dispatcher" service (OIDC-validated by Cloud Run IAM before container runs)
   │  Enqueues a Cloud Tasks HTTP task → Cloud Run Jobs execution (run-to-completion,
   │  up to 24h ceiling available, capped hard at 120s per job — see budget below)
   ▼
Cloud Run Job container (mcp-scan / garak / promptfoo, chosen per task_type)
   │  Runs BEHIND Serverless VPC Access + Cloud NAT egress-only firewall:
   │    - deny RFC1918 (10/8, 172.16/12, 192.168/16), loopback, link-local
   │    - deny 169.254.169.254 (cloud metadata endpoint — the classic SSRF→credential chain)
   │    - allow public egress only
   │  Re-resolves DNS itself and re-checks the resolved IP after every redirect hop
   │  (redirect-based SSRF bypass is the standard evasion — allowlist-over-blocklist,
   │  OWASP SSRF Prevention Cheat Sheet)
   │  Executes the real adversarial probe against target_url (dynamic behavior test,
   │  not description-text regex) → structured JSON result
   ▼
Cloud Run Job → POST https://<worker>/internal/webhook/{job_id}  (HMAC-signed, shared
   secret in Worker + Cloud Run env var — this direction uses HMAC not OIDC, because
   Cloudflare doesn't natively verify Google-issued tokens; OIDC is Worker→GCP only)
   ▼
Worker writes result to D1 (requests row: stage=settled, findings, risk_score, tx_hash)
   ▼
Agent polls GET /jobs/{job_id}  (FREE — no re-charge, keyed by job_id) until status=done
```

**Why hybrid sync/async, not hold-the-connection:** the paying client's own HTTP timeout
(15–30s in most agent frameworks) is the failure point, not the Worker's wall-time limit.
x402 settlement itself already burns 1–3s of the caller's patience on the facilitator
round-trip before any real work starts. Ticket pattern (dispatch fast, poll free, separate
call) is the same shape Cloudflare recommends for its own long-running-agent pattern and the
same shape Cloud Run Jobs (batch, no HTTP response expected) is purpose-built for.

### Auth (two directions, two mechanisms — each native to its own side)
- **Worker → Cloud Run dispatch:** self-signed OIDC-shaped JWT via `jose` + WebCrypto RS256,
  service-account private key as a Worker secret. Cloud Run validates via IAM
  (`roles/run.invoker` bound to the Worker's SA principal) before the container even starts —
  zero app-layer auth code on the GCP side. Cache the signed token (valid up to 1h) in
  Workers `caches` to avoid re-signing every call.
- **Cloud Run → Worker webhook:** HMAC over `method+path+timestamp+body`, shared secret in
  both places. Simpler, and it's the right tool here because Cloudflare has no native verifier
  for Google-issued tokens — don't force OIDC where it doesn't fit.

### Egress containment (this product sells "make our compute fetch a URL you supply" —
### treat it as SSRF-proxy-for-hire from day one)
- Network-layer allowlist enforcement (Serverless VPC Access + Cloud NAT + firewall), not app
  code alone — app code is bypassable, network policy isn't.
- Free MCP-protocol precheck at the Worker (`tools/list` must respond) rejects most SSRF/DDoS
  misuse for free, before a paid job is ever dispatched.
- Rate-limit keyed to the **payer's wallet address** (from the x402 payment proof), not IP —
  agents proxy through shared infra, so IP-keyed limits are trivially defeated.

### Budget caps (bounded downside, per CLAUDE.md barbell discipline)
- Per-job hard timeout: **120s** (even though Cloud Run allows up to 60min for services /
  24h for Jobs) — a malicious/expensive target cannot turn a $0.05 payment into unbounded
  vCPU-seconds.
- `--max-instances` cap on the Cloud Run Job — bounds concurrent spend under a traffic spike
  or abuse burst.
- **Cost floor: ~$0.** Cloud Run free tier = 180,000 vCPU-seconds/month + 360,000 GiB-seconds
  + 2M requests. A 120s-capped job at realistic paid volume (single digits to low tens of
  scans/day at launch) stays inside the free tier for months. Cloud Tasks, Artifact Registry
  (small container images), and VPC Access connector (smallest tier) are likewise free-tier or
  near-zero at this volume. **No capital is at risk building or running this — confirmed.**

### The one Rez atom
GCP project + billing account creation (`gcloud auth login` + link billing +
`gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudtasks.googleapis.com`)
is the only step that requires Rez's identity — account/owner creation cannot be automated by
an agent. **Everything downstream is scriptable via `gcloud`/Terraform once billing exists**:
service account creation, IAM bindings, Cloud Run deploy, Cloud Tasks queue config, VPC
egress firewall, Worker secret binding, D1 schema migration. Build and stage all of it now so
the GCP unlock is a flip, not a project, the moment that atom lands.

---

## 2. THE LEVELED ROADMAP (L2→L6, build order, what makes each autonomous)

**L2 — Capability (executed scans).** *Move:* ship the Cloud Run executed-scan backend
above for one task_type first (`scan_mcp_server_deep` — dynamic tool-call probing via
mcp-scan-class tooling, not just description regex). Priced $0.25–$1, a distinct tier above
today's $0.05 static scan. *Autonomy:* once deployed, every paid call runs it with zero human
touch — no different from today's static endpoint from the buyer's or the loop's perspective.

**L3 — Architecture.** *Move:* split `src/index.ts` into (1) thin Worker = payment gate +
router + D1 writer, (2) config (prices, rule weights, rule-set version, task-type registry)
read from D1/KV at request time instead of compiled into the bundle, (3) move `PAY_TO` /
`FACILITATOR_URL` from plaintext `[vars]` to `wrangler secret put` (small hygiene fix, do it
in the same pass). *Autonomy:* this is the prerequisite for L5 — the loop can only "tune
pricing" or "promote a candidate rule" autonomously if those levers are data, not a
`wrangler deploy` a human has to run.

**L4 — Product/market (distribution).** *Move:* stop relying on passive listing channels
(MCP Registry, 402index, x402 Bazaar — all proven low-convert for commodity plays per prior
memory verdicts) and get discoverable **at the moment of highest buyer intent**: PR the tool
into `mcp-scan`'s own README/ecosystem section and `awesome-mcp-servers`-class docs, register
in agent-framework tool catalogs (Smithery, PulseMCP). All machine/code channels (PRs,
registry APIs) — consistent with the prospector's machine-only-distribution policy — but
targeting install-time intent (the instant an agent is about to add an untrusted MCP server)
instead of a general index nobody browses. *Autonomy:* these are one-time PRs/registrations,
scriptable now; ongoing discoverability afterward requires no repeat human action.

**L5 — Self-improving loop.** *Move:* the full metrics/auto-tune system in section 3.
*Autonomy:* this is the level where "autonomous" stops meaning "runs without a human in the
request path" and starts meaning "improves itself without a human reading a dashboard."

**L6 — Convex expansion.** *Move:* build the Cloud Run backend as a generic
`{task_type, target, params} → container → JSON` job-runner from the start (not
single-purpose), so day-2 SKUs — repo SBOM/CVE scan via trivy/grype, self-domain nuclei-lite
scan with ownership verification, prompt red-team via garak/promptfoo against the buyer's own
system prompt — are new `task_type` rows in D1, not new services. *Autonomy:* marginal build
cost of SKU N+1 drops toward zero once this exists; the loop (section 3, distribution arm)
can propose and ship a new task_type as a play without a new architecture cycle.

Build order: **L3 first** (thin the Worker, externalize config — 1-2 day job, unblocks
everything else), **L2 in parallel** (Cloud Run backend doesn't depend on L3, only on the
Rez atom), **L4 immediately after L2 ships** (nothing to distribute until the paid tier
exists), **L5 wired in continuously as L2/L3 land** (the D1 schema in L3 IS the L5
metrics store — same migration, don't build it twice), **L6 is the shape L2 is built in**,
not a separate later phase.

---

## 3. THE SELF-IMPROVING LOOP

### D1 schema (one append-only table, free tier, zero cost)
```sql
CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  endpoint TEXT NOT NULL,           -- '/scan/mcp', 'mcp:scan_mcp_server_deep', ...
  stage TEXT NOT NULL,              -- discovery|preview|402_issued|paid_attempt|settled
  target_host TEXT,                 -- hostname only, never full payload
  price_usdc REAL,
  price_cohort TEXT,                -- baseline|test_low|test_high (pricing A/B)
  caller_hash TEXT,                 -- sha256(wallet addr) — dedup/repeat-caller, not PII
  rules_version TEXT,               -- which ruleset/task_type scored this request
  findings_count INTEGER,
  risk_score INTEGER,
  tx_hash TEXT,                     -- filled async by the on-chain reconciler
  channel_hint TEXT                 -- referer/UA-derived distribution-channel guess
);
```
Logged via `c.executionCtx.waitUntil(...)` — non-blocking, adds no latency to the paid path.
Replaces `console.log` as ground truth; console.log stays a debug tail only.

### The funnel (first time this is computable)
`discovery → preview → 402_issued (the exact upsell moment) → paid_attempt → settled`
(reconciled against the existing `check_paid_calls.sh` methodology, generalized to sweep
*every* price band $0.005–$1.00, not just tech-risk's). This makes two conversions
measurable for the first time: preview→paid rate by findings-severity bucket (is the upsell
threshold tuned right?), and discovery→first-call attributable to a specific
listing/PR timestamp already recorded in `plays_ledger.txt` (real signal vs. a dead channel,
quantitatively — not a one-time qualitative judgment frozen in `dead_channels.txt`).
Agent-acts-on-finding can't be observed directly; the honest proxy is **repeat-paid-callers
scanning a new target within N days** — adoption, not curiosity.

### Auto-tune detection (weekly, Sonnet-driven, same cadence as `prospector_meta.py`)
Pull distinct targets scanned in 7d + rule-hit distribution + public disclosed MCP
tool-poisoning writeups (Invariant Labs, Pillar Security — free/keyless sources) → propose
candidate rules. **Shadow-deploy discipline:** new rules run `rules_version="candidate"` for
14 days, logged but not billed/scored for real customers. Auto-promote only if hit-rate is in
a sane band (not >40% of all scans — noise, not signal) and doesn't tank preview→paid
conversion for the cohort it fires on. Cheap reversible probe → measure → scale on proof —
the exact CLAUDE.md decision pattern, applied to rule engineering.

### Auto-tune pricing (weekly rollup)
80% `baseline` / 10% `test_low` / 10% `test_high` cohorts by `caller_hash`. Compute
**revenue-per-request** (not raw conversion) per cohort weekly. If a non-baseline cohort beats
baseline by a real margin over a 2-week window with n≥30, it becomes the new baseline; losing
bands retire, two fresh bands open around the new baseline. Simple weekly D1 SQL reallocation
— no ML infra needed.

### Auto-tune distribution — wired into the existing prospector loop, not a parallel system
Extend `prospector_meta.py` to pull a D1 rollup each cycle, written to
`~/.hermes/data/x402_conversion/latest.json` in the **existing sensor convention** the loop
already reads (no new plumbing pattern). Contents: paid-conversion-by-endpoint, rule-hit-rate
table, price-experiment standings, channel-attribution table (impressions vs. settled paid
calls per channel, 30d). Upgrade `dead_channels.txt` from binary dead/alive to a **quantitative
scoreboard** so SENSE reasons from real numbers every cycle. The existing
`ADVANCE or GENERATE ONE PLAY` step now has a quantitative basis to decide "bump price,"
"promote a candidate rule," "kill a channel with real conversion data," or "ship the next
task_type SKU" — closing the loop: the system reads its own funnel and picks its next move
without a human reading a dashboard.

---

## 4. AUTONOMOUS vs REZ

**Zero-input (loop/Claude does, no Rez touch, ever):**
- Every scan execution, D1 logging, funnel tracking, on-chain reconciliation
- Weekly rule-candidate generation, shadow-scoring, auto-promotion/rejection
- Weekly price-cohort rollup and baseline reallocation
- Channel scoreboard updates, dead-channel quantitative re-scoring
- New `task_type` SKU proposals and shipping (L6) once the job-runner shape exists
- All `gcloud`/Terraform provisioning *after* billing exists (SA creation, IAM binds, Cloud
  Run deploy, Cloud Tasks queue, VPC firewall rules, D1 migrations, Worker secret binding)
- Distribution PRs/registrations (Smithery, PulseMCP, docs repos) — one-time but scriptable,
  no recurring human action after

**One-time Rez atoms (irreducible — identity/account creation only):**
| Atom | Unlocks |
|---|---|
| GCP project + billing account, `gcloud auth login` | The entire L2/L3 executed-scan backend (Cloud Run, Cloud Tasks, VPC egress control) — nothing above the static-regex ceiling exists without this |
| (Already done — Base receiving wallet) | Payment settlement — no further atom needed here, xpay is non-custodial, no CDP key required (confirmed in PLAN.md, corrects an earlier wrong assumption) |
| Smithery / GitHub auth (if not already logged in) | L4 registry-listing distribution channel |
| Stripe account (only if the autonomous x402 rail stalls — per STRATEGIC_DIRECTIVE's fallback) | The human-rail AppSec-team-billed audit tier — explicitly NOT the primary path, hold in reserve |

Nothing else requires Rez. No manual monitoring, no "check the dashboard," no ongoing
approval step in the loop itself.

---

## 5. IMMEDIATE NEXT STEPS (ordered, post-handoff)

1. **Hand Rez the one atom now:** GCP project + billing + `gcloud auth login` +
   `gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudtasks.googleapis.com`.
   Nothing below blocks on this except the actual Cloud Run deploy — everything else builds
   in parallel against the spec.
2. **L3 first (unblocks L5's metrics store in the same migration):** add D1 binding to
   `wrangler.toml`, run the `requests` table migration, refactor `makeRoutes()` to read
   price/rule-version from D1/KV instead of hardcoded constants, move `PAY_TO`/
   `FACILITATOR_URL` to `wrangler secret put`.
3. **L2 in parallel:** write the Cloud Run dispatcher + Job container (mcp-scan-class dynamic
   probe), the `jose`+WebCrypto OIDC signer in the Worker, the HMAC webhook receiver, the VPC
   egress firewall rules (deny RFC1918/metadata-IP, allow public only), the 120s job timeout +
   `--max-instances` cap. Stage all of it so it's a `gcloud` apply away from live the moment
   the atom in step 1 lands.
4. **Wire the funnel logging** (`discovery/preview/402_issued/paid_attempt/settled` stages)
   into every existing endpoint, not just the new scan tier — this makes today's static
   endpoints measurable too, at zero extra cost.
5. **Extend `check_paid_calls.sh`** to sweep all price bands ($0.005–$1.00), not just the
   tech-risk band — required before the pricing auto-tune loop (section 3) has real data to
   act on.
6. **Extend `prospector_meta.py`** to emit `~/.hermes/data/x402_conversion/latest.json` and
   upgrade `dead_channels.txt` to the quantitative scoreboard — wires L5 into the loop that's
   already running on a systemd timer, so nothing new needs to be scheduled.
7. **Ship L4 distribution PRs** (mcp-scan README/ecosystem section, awesome-mcp-servers,
   Smithery/PulseMCP registration) the moment the L2 paid tier is live — no value in
   distributing before there's a differentiated product to point at.
8. **First organic paid call at the new tier** is the tripwire: reconciled via the extended
   `check_paid_calls.sh`, logged to `plays_ledger.txt` per existing prospector convention.
   >0 and trending → the loop (section 3) takes it from here autonomously. =0 after the same
   30-day window used elsewhere in this system → treat as a channel/pricing signal to react
   to via the auto-tune loop, not a reason to stop building L6.

**Files for whoever builds next:** `/home/rez/projects/x402-data-api/src/index.ts`,
`/home/rez/projects/x402-data-api/wrangler.toml`, `/home/rez/projects/x402-data-api/PLAN.md`,
`~/.claude/scripts/prospector_routines.sh`, `~/.claude/scripts/prospector_meta.py`,
`~/.claude/prospector/check_paid_calls.sh`, `~/.claude/prospector/dead_channels.txt`,
`~/.claude/prospector/STRATEGIC_DIRECTIVE.md`, `~/.claude/prospector/meta_insights.md`.
