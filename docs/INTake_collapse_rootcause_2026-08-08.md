# x402-data-api intake collapse — root-cause verdict

Date: 2026-08-08 · Source: kanban t_9a3e96c9 (hermes-meta, research) · Author: KAIROS worker

## Question

Gate Rollout Advance (cron 28b59e4613c4) refused to advance x402-data-api out of the
gated cohort on 2026-07-31T06:12 because card-creation volume read 0 vs 1 in the prior
comparable window (floor 50%). Acceptance asks: **was the intake collapse expected
(cadence) or a fleet bug (starved board)?** Second question surfaced during the pass:
**is the merge_lock (frozen 2026-08-04, 70% failure ratio) stale or live?**

## Verdict

1. **The 07-31 intake "collapse" was a cadence artifact, NOT a fleet bug.**
   The gate's refusal was correct behavior (script exited 2 by design — the guardrail
   protects the rollout); the measured collapse was a sub-24h sampling artifact against
   the daily 09:00 prospector cadence. The postmortem written the same day
   (error_budget clear, 2026-07-31T14:03:19Z) documented exactly this: *"Gate REFUSE at
   06:12 was a cadence artifact (0 vs 1 over sub-24h windows vs daily prospector), NOT a
   budget breach."*

2. **The rollout has since advanced past x402 — the original complaint is moot.**
   `data/gate_rollout/state.json` gated_at sequence: kalshi-edge 07-28, grommet 07-29,
   x402-data-api 07-30, black-box 08-03, assay 08-04. A dry-run of the gate today
   (2026-08-08, no --apply) reports: cycle_ran=True, cards after=6 before=6 → volume
   holds → **VERDICT ADVANCE → gate 'bowline'**. x402 is no longer blocking anything.

3. **merge_lock is NOT stale — it reflects a real, ongoing worker-crash problem.**
   Ground truth from task_runs (board x402-data-api), last 10 outcomes today:
   `[blocked, crashed, crashed, crashed, crashed, crashed, crashed, reclaimed, blocked, crashed]`
   → **7/10 = 0.70, still above the 0.5 SLO** the day the lock was frozen. Budget gate
   re-derives from task_runs every foreman tick, so clearing the lock without fixing the
   crash source would re-freeze on the next tick. Specific crash wave on 08-08:
   t_850841d3 crashed 3x (12:24, 13:33, 13:39), t_62fa12ba crashed 3x (14:03, 14:26, 14:51).

4. **The board was never starved at the intake layer.**
   Per-day card creation (Jul 25 – Aug 8): 1,1,4,1,4,1,1, [11 on 08-03 bulk import],
   1,3 — cards kept minting. t_73b934c8 (created 08-08 15:32) is running right now.
   The foreman cron is alive (every 30 min, last 08-08T20:31, status ok, breaker
   `fail=0/3 loop=no cost=0/5 per 300s`) and skips dispatch *only because of the
   merge_lock* — the andon working as designed. Per the 07-20 postmortem, the gateway
   auto-dispatch path is separate from the foreman safety-net lane and was unaffected.

## Recommendation (for Rez)

- **Close the "collapse" question: expected cadence.** No gate bug, no board starvation.
- **Do NOT clear merge_lock yet.** It is live (0.70 today). It will clear itself only
  after the crash source is fixed and 10 consecutive healthy runs push the ratio under
  0.5 — or via a postmortem clear (`error_budget.sh x402-data-api --clear "<postmortem>"`)
  AFTER the crash root cause is addressed.
- **Real follow-up: diagnose the 08-08 worker crash wave** (t_850841d3, t_62fa12ba —
  6 crashes in ~2.5h, plus t_53a440db crashed+reclaimed). That is the thing actually
  holding the board's merge lane, not the gate.

## Evidence trail

- Gate state/dry-run: `~/.hermes/data/gate_rollout/state.json`, `~/.hermes/scripts/gate_rollout_advance.py`
- Postmortems: `~/.hermes/data/x402-data-api-health/postmortem.md` (07-31, 07-20, 07-19)
- Foreman log: `~/.hermes/data/x402-data-api-health/foreman.log` (merge-lock skips every 30 min)
- Lock + budget: `~/.hermes/data/x402-data-api-health/merge_lock`, `error_budget.json`
- Runs: `~/.hermes/kanban/boards/x402-data-api/kanban.db` → task_runs
- Gate cron job 28b59e4613c4 (06:00 daily); foreman cron 8bcb6db5dc07 (every 30 min)
