# Agent-Technique Advisory — external research → our stack (ADVICE ONLY, nothing implemented)

**Date:** 2026-10-19 · **Status:** RESEARCH / ADVISORY. No changes made. No goal file touched.
**Scope (per Rez):** improve our agent techniques from external white papers + others' experiments —
weighted to the first two layers (Claude the model + the "prompt master" / constitution+goal+hooks),
lighter on hermes/x402/automation. Hard constraint: **make it better, not worse.**

Each item: mechanism → how it maps to OUR stack → verdict (ADOPT / ALREADY-HAVE / AVOID) → smallest
change. Nothing here is built; this is the menu for a later "go."

---

## 0. The one principle BOTH deep researchers converged on (non-negotiable)

Self-improving agents fail exactly one way: the thing that makes an edit also grades it, and quietly
weakens its own bar (Gödel/Ouroboros risk; LLM-as-judge agreement collapses 80%→52% off-distribution,
arXiv 2609.02246). The fix every source shares:

- **Split the prompt into an immutable GATE-CORE vs a mutable STRATEGY body.** Only the gate-core holds
  legal gates (bounty submit / capital deploy), the completion oracle, Claims Law, and Stop-hooks —
  **human-edited only, never touchable by any optimizer or by the loop's own altitude tier.**
- **Gate every self-change on a HELD-OUT ground-truth oracle**, never an LLM-as-judge self-score.
- **Version every change (git) + auto-rollback on oracle regression over N cycles.**

**We already hold this line** — when STRATEGIC ALTITUDE was added, the oracle + Claims Law + Stop-hooks
were deliberately left outside the loop's edit surface; it may rewrite the *plan*, never *what counts as
success*. Both researchers independently say that boundary is the whole game. Keep it absolute.

---

## 1. Layers 1–2 (Claude + prompt-master) — the priority adoptions

### A. Self-improving the GOAL prompt against the revenue oracle
- **GEPA** (arXiv 2507.19457) — reflective prompt evolution: reads full execution *trajectories* (our
  cycle ledgers already are this), reflects in natural language on *why* the oracle moved, proposes a
  targeted diff to the strategy body; beats RL by 6–20% with **~35× fewer rollouts** (each rollout = a
  real cycle, so this matters). **Verdict: ADOPT — best single fit.** Smallest change: a periodic job that
  feeds recent `{strategy_version, oracle_delta, failure_modes}` to a GEPA-style reflector that proposes
  ONE diff to STRATEGY.md's strategy body, staged behind a held-out-oracle gate — never auto-applied.
- **OPRO** (arXiv 2309.03409) — LLM-as-optimizer over `{instruction, score}` history. **Verdict: ADOPT as
  the cheap first version** of the above before investing in GEPA.
- **Promptbreeder / EvoPrompt** (2309.16797 / 2309.08532) — population + mutation/crossover of prompt
  variants. **Verdict: ADOPT later / secondary** — layer on only once the single-candidate loop is proven.
- **DSPy** (2310.03714) — compile prompts-as-modules against a metric. **Verdict: ADOPT directionally** —
  target end-state, not a near-term rewrite.
- **TextGrad** (2406.07496) — **AVOID for now** (graph machinery overkill for our ~flat prompt).
- **Self-Rewarding LMs / Constitutional-AI RLAIF** (2401.10020 / 2212.08073) — **AVOID the training/
  self-judge machinery**; we have a real oracle. Keep only CAI's *self-critique-then-revise* as the
  reflection half of GEPA. (Self-reward-as-accept/reject is the #1 "makes it worse.")

### B. Cross-cycle learning — stop the breadth-spray, start converging
(These fix the exact drift observed live: ledger only appends, nothing prunes, so it sprays.)
- **ExpeL voted-insight ledger** (arXiv 2308.10144) — contrast a winning vs losing cycle on the *same
  bet-class*, distill one rule, ADD/UPVOTE/**DOWNVOTE/prune**. **Verdict: ADOPT — highest-leverage fix for
  convergence.** A standing, *pruned* insight list demotes low-confidence approaches instead of letting
  them linger as spray.
- **AWM oracle-gated workflow banking** (arXiv 2409.07429) — bank a reusable multi-step workflow only when
  the **oracle** confirms it earned (not self-report). **Verdict: ADOPT** — reuse what's *proven*.
- **Generative-Agents reflection pass** (arXiv 2304.03442) — importance-tag ledger entries; every N cycles
  distill the top lessons into higher-order entries that dominate future prompts. **Verdict: ADOPT** — feeds
  the altitude tier grounded, derived input instead of raw history.
- **Voyager skill library** (arXiv 2305.16291) — bank small *retrievable* reusable units (scripts, prompt
  templates, integration patterns) separate from prose; fresh cycle *searches* instead of re-deriving.
  **Verdict: ADOPT** — but must carry ExpeL's prune mechanic (append-only library = spray relocated to memory).
- **Goal-drift** (arXiv 2505.02709) — drift tracks *recent-context pattern-matching* more than prompt
  distance; a fixed goal-reinforcement block must sit **separate from the mutable ledger**. **Verdict:
  ADOPT (cheap)** — our fresh-session reset already half-solves this.

---

## 2. Already-have (validated by the literature — don't "fix" these)
- **Fresh-session-per-cycle reset** — stronger than Reflexion's in-context retry; it kills the poisoned
  "I can't" state. Reverting to one long context to add "continuity" would REGRESS. (AVOID that.)
- **Ground-truth oracle completion** (not self-claim) — the exact fix AutoGPT/BabyAGI postmortems converged on.
- **Anti-quit Stop-hooks + bounded cycles** — the "hard stop condition" the field recommends.
- **Strategic-altitude tier + Claims Law** (just added) — matches the self-improvement literature, with the
  gate-core boundary correctly held.

## 3. Would make us WORSE — do not adopt
- Any optimizer/altitude tier editing the **gate-core** (legal gates, oracle, Claims Law, verification).
- **LLM-as-judge / self-reward** as the accept/reject signal for any change — use the oracle.
- **Append-only** memory (ledger or skill library) with no prune/downvote — relocates spray into memory.
- A single agent **generating AND grading** its own insights — gate on oracle or an explicit documented contrast.

## 4. Ranked top adoptions (layers 1–2)
1. ExpeL voted-insight ledger (convergence; kills breadth-spray).
2. GEPA reflective GOAL-prompt improvement, held-out-oracle-gated (OPRO as the cheap first cut).
3. AWM oracle-gated workflow banking (reuse only what's proven).
4. Generative-Agents reflection pass feeding the altitude tier.
5. Structural immutable-core/mutable-strategy split + git auto-rollback (the safety backbone that must
   precede ANY optimizer).

---

## 5. Claude Code / harness engineering (Anthropic's own guidance) — layers 1–2 deeper

Sources: Anthropic "Building Effective Agents," "Effective context engineering for AI agents," Claude Code
docs (headless, subagents, hooks, memory), evals cookbook.

- **⚠ More prose REDUCES adherence (counterintuitive — directly bears on "don't make it worse").** Official
  CLAUDE.md guidance: target **<200 lines/file**; longer files consume context and *reduce rule-following*.
  Our global constitution + every-turn hook injection is far past that. **The reflex to fix drift by adding
  another directive is likely making the prompt-master WORSE, not better.** Verdict: **ADOPT a split** —
  <200-line core + topic-scoped `.claude/rules/` (swarm-schema, legal-gates, skills-authoring) that load only
  when relevant; use a deterministic `PreToolUse` hook for enforcement instead of more prose.
- **Hard stop conditions independent of the Stop-hook.** Anthropic docs explicitly state a Stop-hook that
  always blocks "can keep the session going indefinitely" with no built-in loop-guard — a named description
  of our exact anti-quit architecture. Verdict: **ADOPT** `--permission-prompts none`, `--max-budget-usd`
  per cycle, and `maxTurns` on subagents — guards that are NOT themselves hook-controlled.
- **Structured completion signal.** Use `--output-format json --json-schema` for the oracle / LOOP-CLOSE
  check instead of regex on prose. Verdict: **ADOPT.**
- **Context hygiene.** Two-pass compaction (recall then precision; keep decisions/unresolved, drop raw tool
  output) + hybrid stable/dynamic loading (load stable rules once, fetch ledger just-in-time) instead of
  re-paying the full rule-set every turn. Verdict: **ADOPT.**
- **Oracle/verifier calibration.** Code-based > model-based > human grading; a model-based grader must be
  validated against hand-labeled cases. NOTE the distinction for us: the **money-loop oracle is on-chain
  balance = deterministic/code-based = solid**; it's the **verifier subagent + "win" claims** elsewhere that
  are the uncalibrated model-graders (see `finding_exploit_loop_wins_are_self_attestation`, 8/8 failed repro).
  Verdict: **ADOPT** — calibrate the *verifier*, keep the on-chain oracle as-is.
- **ALREADY-HAVE (validated):** orchestrator-workers (swarm), cheap/expensive model routing, sub-agent context
  isolation, structured note-taking (the ledger).
- **AVOID:** removing the oracle gate; treating the Stop-hook loop as self-limiting; `--bare` (would silently
  kill our hook stack — instead log `system/init` each cycle to catch silent hook/MCP load failures).

## 6. x402 + unattended-automation (layers 3–5, lighter scope)

Sources: Google SRE Book/Workbook, coinbase/x402 README, CDP Bazaar + "get discovered" docs.

- **Bazaar listing survival (money-relevant):** CDP drops any resource with **no settlement for 30 days**;
  ranking uses 30-day call count, unique payers, recency, and metadata completeness. Verdict: **ADOPT** — fill
  every metadata field + output schema; keep one `payTo`. The researcher's "daily self-paid settled call to
  stay listed" idea **conflicts with our hard no-self-dealing rule** — treat listing-survival via a *real
  external* call cadence or accept de-listing; do NOT start self-paying to game ranking. (Flag, not an adopt.)
- **Silent-success detection (best automation fix):** every sensor emits a real output counter
  (`items_processed`), and a **zero count FAILS** the check — kills the "cron exits 0 while doing nothing"
  class. Plus a consumer-side staleness check: `now - fetched_at > 2× interval` = failure. Verdict: **ADOPT**
  (we have `fetched_at`; add the counter + the consumer check). Partially ALREADY-HAVE via shared-sensor-store.
- **Supervisor discipline:** jittered + capped + budgeted relaunch with escalation when the budget runs out;
  run keys `job@scheduled_ts` + lock (never double-launch); idempotency record before any payment/settlement.
  Verdict: **ADOPT** (our breaker/tripwire is a partial ALREADY-HAVE).
- **Page on symptoms, not causes:** alert only on "API not returning valid 402/paid 200" and "no settlement in
  X hours"; thin-traffic SLOs need long windows. Verdict: **ADOPT.**
- **AVOID:** retrying at multiple layers (cron+loop+watchdog) = cascading failure; double-launch; counting our
  own synthetic/self-paid calls as demand (tag them).

## 7. Strongest convergent themes (all 4 researchers agreed)
1. **Prune/converge, don't append.** ExpeL voting + AWM proven-only banking + AutoGPT breadth-is-the-failure
   + "tag synthetic, don't count as demand" → the single fix for the breadth-spray we watched live.
2. **Gate on ground truth, never self-judge.** Gödel warning + no-self-reward + verifier-calibration +
   "exit 0 ≠ health." Our on-chain oracle is the right kind; protect it, calibrate the model-graders.
3. **Immutable gate-core vs mutable strategy** (+ split the oversized CLAUDE.md). The one boundary that
   must never move.
4. **Hard external guards, not self-limiting loops** (budget/maxTurns/permission caps outside the hooks).
5. **Less context, better curated** — more prose past ~200 lines lowers adherence.

## 8. Whole-stack ranked adoptions (if/when you say "go")
1. **ExpeL voted-insight ledger** (prune → convergence; fixes breadth-spray). [layer 2] — ✅ **BUILT 2026-10-19** (`INSIGHTS.md` + one goal pointer line; gate-core untouched).
2. **Split the global CLAUDE.md to <200-line core + scoped rules** (stop the adherence decay; cheap, safe). [layer 2]
3. **GEPA/OPRO self-improving GOAL strategy, held-out-oracle-gated, git-rollback** (the "prompt master" upgrade). [layer 2]
4. **Hard non-hook guards** on the loop (`--max-budget-usd`, `--permission-prompts none`, `maxTurns`). [layer 1]
5. **Silent-success counters + staleness checks** across sensors. [layer 5]
6. **AWM oracle-gated workflow banking + Generative-Agents reflection pass**. [layer 2]
7. **Bazaar metadata/schema completeness** (external-settlement cadence, not self-pay). [layer 4]

---

*All of the above is ADVICE. Nothing is implemented. The goal file was NOT touched this pass. Awaiting Rez's
"go" before any change — and the gate-core (legal gates, on-chain oracle, Claims Law, Stop-hooks) stays
human-only regardless of which items get adopted.*
