#!/usr/bin/env python3
"""DO rows_written budget model for TrafficLog.logHit.

Companion to do_budget_check.py (which models the rows_READ side via /metrics).
This models the rows_WRITTEN side, which ALSO blew its CF free-tier cap on
2026-10-21 (both a 90%-rows_read AND a rows_written-exceeded alert fired at
22:28 UTC). Nothing modelled the write side before this script.

Where writes come from
----------------------
A single global "default" TrafficLog DO funnels every request through logHit():

    if (method !== "PAID" && Math.random() >= NONPAID_SAMPLE) return;   // sample gate
    INSERT INTO hits (...)                                              // 1 row
    if (Math.random() < PRUNE_P)                                        // opportunistic
        DELETE ... LIMIT PRUNE_LIMIT                                    // bounded delete

Each INSERT writes the table row PLUS one entry per secondary index. The `hits`
table currently has TWO indexes (hits_ts, hits_method_ts), so one INSERT costs
(1 + 2) = 3 rows_written. A prune DELETE of up to PRUNE_LIMIT rows drops each
row's index entries too, so it costs up to PRUNE_LIMIT * (1 + n_idx) rows_written.

PAID hits are never sampled (they are the revenue signal); non-paid hits are
sampled at NONPAID_SAMPLE to protect exactly this budget.

Ceiling
-------
Solve for the maximum non-paid requests/day the current knobs sustain under the
100k/day free-tier rows_written cap. If our real non-paid volume approaches that
ceiling, lower NONPAID_SAMPLE (a one-constant, fully reversible change: it only
coarsens the ×(1/rate) non-paid estimate in getStats, never touches a read path
or the PAID signal) or drop the redundant hits_ts index (getStats — the only
reader that needs ts-ordering across all methods — is secret-gated and rare).

Run:  python3 -I scripts/do_write_budget_check.py [--nonpaid N] [--sample R] [--indexes K]
Exit 0 if the chosen knobs stay under budget at the given non-paid volume (or if
no --nonpaid is given, always 0 — it just prints the ceiling table).
"""
import argparse

BUDGET = 100_000          # CF free-tier rows_written/day
PAID_PER_DAY = 300        # generous upper bound on PAID inserts/day (gross ~6673 lifetime)
PRUNE_P = 0.001           # TrafficLog prune probability per insert
PRUNE_LIMIT = 100         # rows deleted per prune event


def writes_per_insert(n_idx: int) -> float:
    """Row + one entry per secondary index."""
    return 1 + n_idx


def prune_writes_per_insert(n_idx: int) -> float:
    """Expected prune cost amortised per insert."""
    return PRUNE_P * PRUNE_LIMIT * (1 + n_idx)


def writes_per_day(nonpaid: int, sample: float, n_idx: int) -> float:
    inserts = PAID_PER_DAY + nonpaid * sample
    return inserts * (writes_per_insert(n_idx) + prune_writes_per_insert(n_idx))


def ceiling_nonpaid(sample: float, n_idx: int) -> float:
    """Max non-paid req/day before rows_written hits BUDGET."""
    per_insert = writes_per_insert(n_idx) + prune_writes_per_insert(n_idx)
    max_inserts = BUDGET / per_insert
    return max(0.0, (max_inserts - PAID_PER_DAY) / sample)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--nonpaid", type=int, default=None,
                    help="assumed non-paid requests/day; if set, exit 1 when over budget")
    ap.add_argument("--sample", type=float, default=0.01,
                    help="NONPAID_SAMPLE (current prod: 0.01)")
    ap.add_argument("--indexes", type=int, default=2,
                    help="secondary indexes on hits (current: 2 — hits_ts, hits_method_ts)")
    args = ap.parse_args()

    print(f"BUDGET={BUDGET:,} rows_written/day  PAID/day<={PAID_PER_DAY}  "
          f"indexes={args.indexes}  prune(p={PRUNE_P},limit={PRUNE_LIMIT})\n")
    print(f"  per-insert write cost = {writes_per_insert(args.indexes):.0f} "
          f"+ {prune_writes_per_insert(args.indexes):.2f} (prune) "
          f"= {writes_per_insert(args.indexes)+prune_writes_per_insert(args.indexes):.2f}\n")

    print("non-paid req/day ceiling by (sample rate, index count):")
    for n_idx in sorted({1, 2, args.indexes}):
        for s in sorted({0.005, 0.01, 0.02, args.sample}):
            cap = ceiling_nonpaid(s, n_idx)
            mark = "  <-- current prod" if (s == args.sample and n_idx == args.indexes) else ""
            print(f"  idx={n_idx} sample={s:<6} ceiling={cap:>14,.0f} non-paid req/day{mark}")

    over = False
    if args.nonpaid is not None:
        w = writes_per_day(args.nonpaid, args.sample, args.indexes)
        pct = 100 * w / BUDGET
        flag = "OVER" if w > BUDGET else "ok"
        print(f"\nat non-paid={args.nonpaid:,}/day sample={args.sample} idx={args.indexes}: "
              f"rows_written/day={w:,.0f} = {pct:.1f}% [{flag}]")
        over = w > BUDGET

    print()
    if over:
        print("FAIL: over the rows_written budget at the assumed volume. "
              "Lower --sample or drop the redundant hits_ts index.")
        return 1
    print("PASS (ceiling table above shows headroom at each knob setting).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
