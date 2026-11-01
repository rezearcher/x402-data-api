WHAT: KILL the third-party GitHub-issue outreach cluster. 86 blocked cards on this board (titles "Open GitHub issue on <repo>", "Post x402-data-api outreach issue to ...", "Execute outreach/GitHub issue ...", "Create GitHub issue on ...") are a dead method. Archive all of them and record the method in the negative-knowledge graveyard so no prospector re-files it.

WHY: outreach/gh/issues_auto.txt already holds 107 filed issue URLs, yet ~/.hermes/data/x402-revenue/latest.json (2026-11-01) shows total_external_usdc=0.88402, balance_delta_since_last=0.0, fresh_inflow=false: zero measurable conversion. The 86 cards are all blocked; sampled t_3efe4afa crashed x2 on "No usable credentials found for provider deepseek" (compute law: claude -p only). fleet_budget has x402-data-api at 9/10 failed, starving the real gap-closers t_aaafb8ec (sensor 2.4M blocks behind tip), t_83bb9ad7 and t_d65ff5f1. GAP: revenue_usd_corrected=0.88402, need >=1.0 (0.116 short); the binding problem is measurement and dispatch capacity, not another outreach channel. Gap-contribution: frees error budget so the 3 measurement cards run and reveal or rule out the unseen 56 days of settlements. Unsolicited issues on repos we do not own are also a reputation risk.

FILES: kanban board x402-data-api only (archive 86 cards); graveyard entry via ~/.claude/skills/breathing-life/scripts/graveyard.sh. No src/, no money code.

ACCEPTANCE: CHECK: test "$(hermes kanban --board x402-data-api list 2>&1 | grep -E '^. t_[0-9a-f]+ +(blocked|ready|todo)' | grep -cE 'Open GitHub issue|Post x402-data-api outreach|Execute (GitHub|outreach)|Create GitHub issue')" -le 5
CHECK: test "$($HOME/.claude/skills/breathing-life/scripts/graveyard.sh list 'github issue outreach' 2>&1 | grep -ci 'outreach')" -ge 1
METRIC: open_outreach_cards <= 5

GUARDRAILS:
  - isolated worktree only
  - archive only, never delete data
  - additive-only for money code (none touched)
  - never push to or open issues on repos that are not ours
  - keep t_aaafb8ec, t_83bb9ad7, t_d65ff5f1, t_501da5de open
  - no paid API for any worker
  - the irreversible action (bounty submission, capital deploy) stays gated to the human

TYPE: research
BUDGET: --max-runtime 1200
