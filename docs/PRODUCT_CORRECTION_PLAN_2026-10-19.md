# Product Correction Plan + Claims-Truth Ledger

**Date:** 2026-10-19 · **Owner:** Claude (Opus 4.8) · **Pairs with:** `docs/PRODUCT_REVIEW_2026-10-19.md`
**Purpose:** Correct the issues the review found, and bake the corrections into *process* so a future
session does this by default. **Hard rule of this plan: no claim ships ahead of its measurement
(No Vaporware).** For every "trust" claim we want to make, this doc declares the exact work that makes
it TRUE and the gate that proves it.

---

## 1. What we are correcting

**A. Aim.** The loop optimized for shopper bots (structural ceiling ~$1.36/day → ~2 yr to $1,000). The
money is in integrators (one client at 2k calls/day = $1,000 in 50 days, ~14× faster). → Re-aim at
integrators; stop price-cutting for bots.

**B. Trust layer.** Our differentiated SKU (`/chain/token-report`, `/gate/swap`) is good but wrapped in
zero trust signals — no uptime, no accuracy claim, buried trial, one chain. Integrators risking capital
need those signals. → Build the trust layer **honestly** (measured, not asserted).

---

## 2. Ground-truth reality check (verified on disk/code 2026-10-19 — prevents vaporware)

| Thing | Claimed in review | Actual verified state |
|---|---|---|
| Uptime/latency | "surface the sensor we already measure" | ❌ **No latency/uptime sensor exists.** `traffic_48h.json` is hit-counts only. `src/index.ts:320` ToS says *"no uptime commitment."* Must **build** measurement first. |
| Free real-token trial | "build a trial" | ✅ **Already exists**: `/gate/swap/preview?token=<0x>` = 3 free/day/IP; `/chain/token-report/preview` = full depth free. **Buried, not missing.** Cap on token-report/preview unverified. |
| Accuracy claim | "publish agreement %" | ❌ Not benchmarked; verdict explicitly hedged ("heuristics, not guarantees", `src/index.ts:315`). Must **build** a benchmark harness. |
| Multi-chain | "add ETH+BSC (P1)" | ⚠️ **44-callsite refactor, deferred** (Division memory `x402-multichain-refactor-44-callsites-deferred`). Base name hardcoded in responses; `baseRpc` global. Must be **additive `/chain/eth/*`, demand-gated** — not a refactor. |
| Rate-limit primitive | — | ✅ `UsageCounter` Durable Object exists (`src/usage_counter.ts`) — trial cap = extend existing infra, not new. |

---

## 3. The Claims-Truth Ledger — *what must be done to make each claim TRUE*

**Standing rule:** a row cannot be published until its **Gate** passes, with the evidence on disk/in code.
If a gate fails (e.g. accuracy is mediocre), we publish the honest methodology instead of a number — we
**never** publish the claim unmeasured.

| # | Claim we want to make | Status today | Work to make it TRUE | Gate (evidence, no theater) | Publishable when |
|---|---|---|---|---|---|
| L1 | Rolling uptime % | not measured | Cron probe hits each key preview every 5 min; append success/fail + latency to `~/.hermes/data/x402-data-api-uptime/latest.json` (shared-sensor-store pattern); add `GET /status` that serves it | ≥14 days of real samples on disk; `/status` returns them | after 14d of samples — publish the **measured** number only, never a round "99.9%" |
| L2 | p50/p95 latency | ad-hoc only (2.8s/0.95s once) | Same probe records per-call ms per endpoint | ≥1,000 samples/endpoint | with L1 — publish measured percentiles per endpoint |
| L3 | Free real-token trial | ✅ true for gate/swap; unverified cap on token-report | (a) verify/add per-IP/day cap on `/chain/token-report/preview` via `UsageCounter` DO; (b) surface the trial in README + a one-line prospect pitch | curl proves cap enforced AND full body returns | **gate/swap: now.** token-report: once cap verified |
| L4 | Verdict accuracy ("agrees with GoPlus on N%") | not benchmarked | `scripts/benchmark_token_report.py`: labeled set (known honeypots + bluechips + GoPlus as reference), run token-report, compute agreement / precision / recall | reproducible run on ≥100 tokens, output committed | publish **measured** agreement; if weak, publish methodology + our sell-sim edge instead — **no unmeasured %** |
| L5 | Multi-chain (ETH/BSC) | Base-only; refactor-deferred | DEMAND-GATED: on a named buyer request, add additive `/chain/eth/*` route set with per-request chain ctx (never refactor `baseRpc`) | one named buyer on record asking for chain X | per-chain, as each ships |

**L3 is the only one publishable today** (gate/swap trial already true). L1/L2/L4 require building the
measurement first — that is the "do more to make it true" the ask calls for, now declared with gates.

---

## 4. Build sequence (executes on Rez's "go"; stays research until then)

1. **L3 surface + cap** (cheapest, converts Krystian now): README trial section + prospect one-liner;
   verify/add token-report/preview cap. → then reply to Krystian with "test your own token free, here's the curl."
2. **L1+L2 uptime/latency probe + `/status`** (directly answers Krystian's uptime question — honestly, once samples exist).
3. **L4 accuracy benchmark** (the trust anchor for a safety product).
4. **L5 multi-chain** — do nothing until a named buyer asks; then additive route set.

Each item ships under `phased-deploy-discipline` (stop-test-commit per phase); new routes need the known
second `deploy.sh` run to go live (PLAN.md cycle 62aj).

---

## 5. Making it part of the process (permanent — so "if asked in future" this is just how we operate)

Three durable changes, done this turn (process), not awaiting go:

1. **`makemoney.goal` amendment** (the loop reads it every cycle): adds the **AIM: integrator-first**
   target, the **CLAIMS LAW (No Vaporware)**, and the **multi-chain demand-gate**. Surgical/additive,
   reversible via git.
2. **Skill `pay-per-call-product-review`** (`~/.claude/skills/`): the reusable methodology — client-archetype
   test (integrator vs bot), trust-layer audit, the Claims-Truth Ledger template, demand-gate rule. So the
   next "review the product / make it better" request runs this process automatically.
3. **The CLAIMS LAW as a standing gate:** any published claim (uptime/accuracy/SLA/latency/chains) must
   point to a measurement artifact on disk or in code. No claim ships ahead of its measurement. If not
   measured → build the measurement or don't claim — and the ledger (this doc) records which.

---

## 6. Risks / steelman (argue against before adopting)

- **Integrator-first could starve breadth-discovery.** Bots probe us and some directories (AgentPay)
  rank on payer depth. *Mitigation:* keep Bazaar/registry metadata accurate (cheap, already running); we
  only stop the *price-cut* cycles, not the listing hygiene.
- **Amending the goal file changes autonomous behavior.** *Mitigation:* additive + surgical; git-reversible;
  shown in the plan before it runs.
- **Full-depth free trial is a cost/abuse surface.** *Mitigation:* L3 cap via existing DO; previews are
  free feeds anyway (~$0 marginal).
- **The accuracy benchmark might show we're mediocre.** That's the *point* of the gate — we then don't
  claim a number. Finding this in private is cheaper than a buyer finding it in production.

---

## 7. What I did this turn vs. what awaits "go"

- **Done now (process):** this plan + Claims-Truth Ledger; `makemoney.goal` amendment; the skill.
- **Awaits your go (product build):** L1–L4 (L5 is demand-gated). All zero-capital, no legal gate.
