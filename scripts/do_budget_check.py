#!/usr/bin/env python3
"""DO rows_read budget check for the public /metrics endpoint.

Why this exists: /metrics is the only public, unauthenticated path that reads a
Durable Object on every cache MISS (TrafficLog.getNetExternalPaid scans every
PAID row in a 30-day window). CF free tier allows 5,000,000 rows_read/day. The
daily cost is (misses/day) * (PAID rows read per call). A short edge-cache TTL
caps misses but NOT rows-per-miss, so the TTL must be chosen against the real
PAID row count.

History: a 60s edge cache (cycle 95) capped misses at 1440/day but each miss
still read ~6673 rows -> 9.6M/day = 192% of budget; the account exceeded the
limit on 2026-10-21 AFTER the cache shipped, 500-ing the DO layer until UTC
reset. Cycle 96 raised the TTL to 3600s (24 misses/day).

Run:  python3 -I scripts/do_budget_check.py [--p30 N] [--ttl SECONDS]
Exit 0 if under budget at the chosen TTL, 1 if over.
"""
import argparse

BUDGET = 5_000_000      # CF free-tier rows_read/day
SCAN_CAP = 50_000       # TrafficLog.SCAN_CAP — max rows a single read touches
SECONDS_PER_DAY = 86_400


def rows_per_day(p30: int, ttl: int) -> int:
    misses = SECONDS_PER_DAY // ttl
    return misses * min(p30, SCAN_CAP)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--p30", type=int, default=6673,
                    help="PAID rows in the trailing 30d window (default: all-time gross as worst realistic)")
    ap.add_argument("--ttl", type=int, default=3600,
                    help="edge-cache TTL in seconds for /metrics (current prod: 3600)")
    args = ap.parse_args()

    print(f"BUDGET={BUDGET:,} rows_read/day  SCAN_CAP={SCAN_CAP:,}  P30={args.p30:,}\n")
    chosen_over = False
    for ttl in sorted({60, 900, 3600, args.ttl}):
        reads = rows_per_day(args.p30, ttl)
        pct = 100 * reads / BUDGET
        flag = "OVER" if reads > BUDGET else "ok"
        marker = "  <-- current prod" if ttl == args.ttl else ""
        print(f"TTL={ttl:>5}s  misses/day={SECONDS_PER_DAY // ttl:>5}  "
              f"rows_read/day={reads:>12,}  = {pct:6.1f}% [{flag}]{marker}")
        if ttl == args.ttl and reads > BUDGET:
            chosen_over = True

    print()
    if chosen_over:
        print(f"FAIL: at TTL={args.ttl}s /metrics alone exceeds the daily budget. Raise the TTL.")
        return 1
    print(f"PASS: at TTL={args.ttl}s /metrics stays under the daily rows_read budget.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
