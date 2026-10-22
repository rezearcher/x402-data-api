#!/usr/bin/env python3
"""DO cost model for TrafficLog — rows_written AND DO operations (the real cap).

Companion to do_budget_check.py (which models the rows_READ side via /metrics).
This models the WRITE side and, more importantly, the DO-OPERATION-COUNT side —
the free-tier limit that actually tripped on 2026-10-19 and again on 2026-10-21
(the "Durable Objects daily operation limit exceeded" CF alerts, which knocked
BOTH the TrafficLog and UsageCounter DOs offline — i.e. a global DO-ops cap, not
a per-DO storage cap).

What changed 2026-10-22 (the fix this script now models)
--------------------------------------------------------
A single global "default" TrafficLog DO funnels traffic through logHit(). The
old design SPLIT the non-paid sample across two gates:

    # middleware (runs per request):
    if (path !== "/mcp" && Math.random() < 0.1)   stub.logHit(...)   # 10% -> DO RPC
    # inside logHit:
    if (method !== "PAID" && Math.random() >= 0.01) return;          # keep 1% of those

Net rows KEPT = 0.1 * 0.01 = 0.001 of non-paid. But a DO *operation* (the RPC
invocation) fired at the middleware's 10% rate — ~100x more DO ops than retained
rows. DO operations, not rows, are the binding free-tier limit, so this is what
blew the daily cap. (As a bonus the old getStats scale 1/0.01=100 under-reported
true non-paid volume 10x, since the real effective rate was 0.001.)

The fix folds both gates into ONE at the call site:

    # middleware:
    if (path !== "/mcp" && Math.random() < NONPAID_SAMPLE)  stub.logHit(...)
    # logHit: no internal sample — persists whatever reaches it (PAID always)

with NONPAID_SAMPLE = 0.001. Now a DO op fires ONLY for a row we keep: non-paid
DO ops drop 100x with IDENTICAL row retention, and getStats' 1/0.001=1000 scale
is finally accurate.

Levers if volume still approaches a cap (all reversible, one constant each):
  * lower NONPAID_SAMPLE (coarsens the getStats estimate; never touches reads/PAID)
  * drop the redundant hits_ts index (getStats is the only all-method ts reader;
    it is secret-gated and rare)

Run:  python3 -I scripts/do_write_budget_check.py [--nonpaid N] [--sample R]
                                                  [--indexes K] [--ops-budget M]
Exit 1 if the chosen knobs exceed EITHER the rows_written OR the DO-ops budget at
the assumed non-paid volume; else 0 (prints the ceiling tables).
"""
import argparse

WRITE_BUDGET = 100_000    # CF free-tier rows_written/day
PAID_PER_DAY = 300        # generous upper bound on PAID inserts/day (gross ~6700 lifetime)
PRUNE_P = 0.001           # TrafficLog prune probability per insert
PRUNE_LIMIT = 100         # rows deleted per prune event

# DO daily operation cap. CF does not publish one clean number for the free
# allocation and it has shifted over time; model it parametrically and default
# to a deliberately conservative figure so the ceiling we quote is pessimistic.
# The point of this model is the *ratio*: the fix cuts non-paid DO ops 100x.
OPS_BUDGET = 1_000_000

# Reads that also cost DO operations (per day). /metrics is edge-cached 3600s
# when healthy => 24 misses/day, each miss = 2 DO ops (UsageCounter + TrafficLog).
# Secret-gated endpoints (traffic-stats, reconcile) are rare; bound generously.
READ_OPS_PER_DAY = 24 * 2 + 50


def writes_per_insert(n_idx: int) -> float:
    """Row + one entry per secondary index."""
    return 1 + n_idx


def prune_writes_per_insert(n_idx: int) -> float:
    """Expected prune cost amortised per insert."""
    return PRUNE_P * PRUNE_LIMIT * (1 + n_idx)


def inserts_per_day(nonpaid: int, sample: float) -> float:
    return PAID_PER_DAY + nonpaid * sample


def writes_per_day(nonpaid: int, sample: float, n_idx: int) -> float:
    return inserts_per_day(nonpaid, sample) * (writes_per_insert(n_idx) + prune_writes_per_insert(n_idx))


def do_ops_per_day(nonpaid: int, sample: float) -> float:
    """One DO RPC per retained non-paid logHit + per PAID logHit + reads.

    This is the key metric: with the single-gate design the non-paid RPC rate IS
    `sample` (0.001), not the old 0.1 middleware rate.
    """
    return inserts_per_day(nonpaid, sample) + READ_OPS_PER_DAY


def ceiling_nonpaid_writes(sample: float, n_idx: int) -> float:
    per_insert = writes_per_insert(n_idx) + prune_writes_per_insert(n_idx)
    max_inserts = WRITE_BUDGET / per_insert
    return max(0.0, (max_inserts - PAID_PER_DAY) / sample)


def ceiling_nonpaid_ops(sample: float) -> float:
    return max(0.0, (OPS_BUDGET - READ_OPS_PER_DAY - PAID_PER_DAY) / sample)


def main() -> int:
    global OPS_BUDGET
    ap = argparse.ArgumentParser()
    ap.add_argument("--nonpaid", type=int, default=None,
                    help="assumed non-paid requests/day; if set, exit 1 when over either budget")
    ap.add_argument("--sample", type=float, default=0.001,
                    help="NONPAID_SAMPLE (current prod after 2026-10-22 fix: 0.001)")
    ap.add_argument("--indexes", type=int, default=2,
                    help="secondary indexes on hits (current: 2 — hits_ts, hits_method_ts)")
    ap.add_argument("--ops-budget", type=int, default=OPS_BUDGET,
                    help=f"assumed CF free-tier DO ops/day cap (default {OPS_BUDGET:,}, conservative)")
    args = ap.parse_args()
    OPS_BUDGET = args.ops_budget

    print(f"WRITE_BUDGET={WRITE_BUDGET:,} rows/day  OPS_BUDGET={OPS_BUDGET:,} DO-ops/day  "
          f"PAID/day<={PAID_PER_DAY}  indexes={args.indexes}  prune(p={PRUNE_P},limit={PRUNE_LIMIT})")
    print(f"  per-insert write cost = {writes_per_insert(args.indexes):.0f} + "
          f"{prune_writes_per_insert(args.indexes):.2f} (prune) = "
          f"{writes_per_insert(args.indexes)+prune_writes_per_insert(args.indexes):.2f}")
    print(f"  read DO-ops/day (metrics misses + secret-gated) = {READ_OPS_PER_DAY}\n")

    print("non-paid req/day ceiling by sample rate (the binding one is the MIN of the two):")
    for s in sorted({0.0005, 0.001, 0.01, 0.1, args.sample}):
        cw = ceiling_nonpaid_writes(s, args.indexes)
        co = ceiling_nonpaid_ops(s)
        binding = "ops" if co < cw else "writes"
        mark = "  <-- current prod" if s == args.sample else ""
        print(f"  sample={s:<7} writes_ceiling={cw:>14,.0f}  ops_ceiling={co:>14,.0f}  "
              f"binding={binding}{mark}")
    print(f"\n  (old split gate fired non-paid DO ops at the 0.1 middleware rate -> "
          f"ops_ceiling={ceiling_nonpaid_ops(0.1):,.0f} non-paid/day; the 0.001 single gate "
          f"lifts it 100x to {ceiling_nonpaid_ops(0.001):,.0f}.)")

    over = False
    if args.nonpaid is not None:
        w = writes_per_day(args.nonpaid, args.sample, args.indexes)
        o = do_ops_per_day(args.nonpaid, args.sample)
        wp, op = 100 * w / WRITE_BUDGET, 100 * o / OPS_BUDGET
        over = w > WRITE_BUDGET or o > OPS_BUDGET
        print(f"\nat non-paid={args.nonpaid:,}/day sample={args.sample} idx={args.indexes}:")
        print(f"  rows_written/day = {w:,.0f} = {wp:.1f}% [{'OVER' if w>WRITE_BUDGET else 'ok'}]")
        print(f"  DO-ops/day       = {o:,.0f} = {op:.1f}% [{'OVER' if o>OPS_BUDGET else 'ok'}]")

    print()
    if over:
        print("FAIL: over a DO budget at the assumed volume. "
              "Lower --sample or drop the redundant hits_ts index.")
        return 1
    print("PASS (ceiling tables above show headroom at each knob setting).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
