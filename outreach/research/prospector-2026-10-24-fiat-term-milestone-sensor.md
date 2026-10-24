WHAT: Make the milestone sensor see BOTH rails. Extend .metrics/reconcile_live_revenue.py (producer of revenue_usd_corrected) to compute corrected = organic_x402_usdc (from ~/.hermes/data/x402-revenue/latest.json total_external_usdc, per blocked t_501da5de) PLUS fiat_gross_usd (from live /metrics .fiat.total_gross_usd on x402-data-api.sigrunner.workers.dev, accept only HTTP 200, degrade-open to 0). Write ~/.hermes/data/x402-data-api/metrics/revenue_usd_corrected plus a .revenue_usd_corrected_timestamp, and add a 15-min cron entry so it refreshes.

WHY: gap.json milestone is "first paid dollar reconciled" on a thesis with two rails (x402 + Stripe). The sensor reads x402 only, and is stale at 0.005 vs 0.769 real. Line B (143 scorecards, claim, Stripe monitor sub) is the only rail with a human-priced path, and its first invoice.paid is currently INVISIBLE to the milestone (live /metrics fiat = 0 count, 0 gross). Without this, the first fiat dollar would not move the gap and the fleet would keep PARK-ing the project (t_2d115862) on a false flat line. Status quo: 0.005 (0.5% of threshold). Expected: reading becomes 0.769 now (77% of threshold) and any Stripe dollar lands within 15 min. Complements, does not duplicate, t_501da5de (x402-only repoint; this card depends on its approach and adds the fiat term).

FILES: .metrics/reconcile_live_revenue.py, .metrics/compute_revenue_usd.py, tests under tests/ (new, unit test with mocked latest.json and /metrics payloads). Money code is additive-only: no change to src/ payment paths.

TYPE: build
BUDGET: --max-runtime 3600
ACCEPTANCE: CHECK: python3 -m pytest tests/test_revenue_fiat_term.py -q && python3 .metrics/reconcile_live_revenue.py --dry-run --mock-fiat-usd 1.5 | grep -q "revenue_usd_corrected=2.269" && test $(( $(date +%s) - $(cat /home/rez/.hermes/data/x402-data-api/metrics/.revenue_usd_corrected_timestamp) )) -lt 1800
METRIC: revenue_usd_corrected >= 0.76
GUARDRAILS:
  - isolated worktree only; additive for money code (no src/ payment path changes)
  - read-only against Stripe and the Worker (no checkout creation, no spend)
  - never push to repos that are not ours; do not clear board STOP flags by hand
  - real capital or bounty submission stays gated to Rez
