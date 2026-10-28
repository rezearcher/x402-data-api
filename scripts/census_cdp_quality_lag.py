#!/usr/bin/env python3
"""Census the CDP Bazaar's `quality`-counter lag across the whole public catalog.

Card t_3814c750. The question this answers, with a population instead of an anecdote:

  Is a frozen `quality.lastCalledAt` (a) normal eventual consistency that every
  record exhibits, (b) a property of OUR host / OUR record / self-settlements, or
  (c) a global outage of the counter leg?

The 45-sample trajectory probe (`scripts/probe_cdp_index_latency.py`) can only show
that ONE record sat still. It cannot distinguish "our record is sick" from "every
record's counter is written by a delayed rollup". This script samples many records
once and reports the distribution of

    delta = lastUpdated - quality.lastCalledAt        (seconds, +ve = counter behind)

Two fields, one record, two different clocks:
  lastUpdated  moves within ~0.1-1.3 s of a settled call (per-call write)
  quality.*    is a rollup; the vendor documents a six-hour recompute schedule for
               the quality/ranking metrics (docs.cdp.coinbase.com/x402/seller/
               get-discovered.md, "My ranking has not moved since my last payment")

Read-only: GET /discovery/resources and /discovery/search only. No settle, no
verify, no writes. Keeps well inside the ~500-request 429 budget (default 6 pages
+ 12 queries = 18 requests).

Usage:
  python3 scripts/census_cdp_quality_lag.py                       # default sample
  python3 scripts/census_cdp_quality_lag.py --pages 10 --out logs/census.json
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://api.cdp.coinbase.com/platform/v2/x402/discovery"

DEFAULT_QUERIES = [
    "token security", "weather", "price", "image generation", "search",
    "wallet balance", "gas price", "honeypot detector", "token report",
    "defi yields", "crypto funding", "market brief",
]


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def ts(value):
    """Parse an ISO-8601 instant. Never compare these as strings: '...47.625Z'
    sorts BEFORE '...47Z' lexicographically, which silently inverts a
    'did this advance?' check (bug already paid for once, t_d5138bac)."""
    if not value:
        return None
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    if "." in v:
        head, _, tail = v.partition(".")
        n = 0
        while n < len(tail) and tail[n].isdigit():
            n += 1
        frac, rest = tail[:n], tail[n:]
        v = f"{head}.{frac[:6].ljust(6, '0')}{rest or '+00:00'}"
    dt = datetime.fromisoformat(v)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def collect(pages=6, queries=None):
    """Return {resource: record}. Deduped, so a record seen in both the paginated
    catalog and a search result is counted once."""
    records = {}
    for offset in range(0, pages * 20, 20):
        d = get(f"{API}/resources?limit=20&offset={offset}")
        items = d.get("resources") or d.get("items") or []
        for r in items:
            if r.get("resource"):
                records.setdefault(r["resource"], r)
        if len(items) < 20:
            break
    for q in (queries if queries is not None else DEFAULT_QUERIES):
        try:
            d = get(f"{API}/search?query={urllib.parse.quote(q)}&limit=20")
        except Exception as e:            # one bad query must not void the census
            print(f"  ! search {q!r}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        for r in d.get("resources") or d.get("items") or []:
            if r.get("resource"):
                records.setdefault(r["resource"], r)
    return records


def rows_from(records):
    rows = []
    for res, r in records.items():
        q = r.get("quality") or {}
        lu, lc = ts(r.get("lastUpdated")), ts(q.get("lastCalledAt"))
        if not lu or not lc:
            continue
        rows.append({
            "resource": res,
            "lastUpdated": r.get("lastUpdated"),
            "lastCalledAt": q.get("lastCalledAt"),
            "delta_s": round((lu - lc).total_seconds(), 3),
            "calls30d": q.get("l30DaysTotalCalls"),
            "payers30d": q.get("l30DaysUniquePayers"),
        })
    rows.sort(key=lambda x: -x["delta_s"])
    return rows


def summarise(rows):
    if not rows:
        return {"n": 0}
    d = sorted(abs(r["delta_s"]) for r in rows)

    def pct(p):
        return round(d[min(len(d) - 1, int(p / 100.0 * len(d)))], 3)

    def within(sec):
        return sum(1 for x in d if x <= sec)

    # Volume buckets test the "it is only high-traffic rollups that lag" hypothesis.
    buckets = {}
    for r in rows:
        c = r["calls30d"] or 0
        key = "0" if c == 0 else "1-9" if c < 10 else "10-99" if c < 100 else "100-999" if c < 1000 else "1000+"
        buckets.setdefault(key, []).append(abs(r["delta_s"]))
    by_volume = {k: {"n": len(v), "median_s": round(statistics.median(v), 3)}
                 for k, v in sorted(buckets.items())}

    return {
        "n": len(d),
        "median_s": round(statistics.median(d), 3),
        "p75_s": pct(75), "p90_s": pct(90), "p95_s": pct(95), "p99_s": pct(99),
        "max_s": round(d[-1], 3),
        "within_5s": within(5), "within_60s": within(60), "within_3600s": within(3600),
        "pct_within_5s": round(100.0 * within(5) / len(d), 1),
        "by_calls30d_bucket": by_volume,
        "counter_lags_over_1h": len(d) - within(3600),
        "counter_ahead_over_1h": sum(1 for r in rows if r["delta_s"] < -3600),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=6, help="20-record pages of /discovery/resources")
    ap.add_argument("--queries", nargs="*", default=DEFAULT_QUERIES)
    ap.add_argument("--out", default="", help="write the census (stats + every row) here")
    args = ap.parse_args()

    records = collect(args.pages, args.queries)
    rows = rows_from(records)
    stats = summarise(rows)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"census @ {now}   records sampled: {len(records)}   comparable: {stats['n']}")
    for k in ("median_s", "p75_s", "p90_s", "p95_s", "p99_s", "max_s"):
        print(f"  {k:>10}: {stats.get(k)}")
    print(f"  within  5s: {stats.get('within_5s')} ({stats.get('pct_within_5s')}%)")
    print(f"  within 60s: {stats.get('within_60s')}")
    print(f"  within  1h: {stats.get('within_3600s')}")
    print("  by 30d call volume:")
    for k, v in stats.get("by_calls30d_bucket", {}).items():
        print(f"    {k:>8}: n={v['n']:<4} median={v['median_s']}s")
    print("  worst tail (counter behind the record):")
    for r in rows[:8]:
        print(f"    {r['delta_s']/3600:7.2f}h  calls30d={r['calls30d']} payers={r['payers30d']}  {r['resource'][:64]}")

    if args.out:
        with open(args.out, "w") as fh:
            json.dump({"generated_at": now, "api": API, "stats": stats, "rows": rows},
                      fh, indent=1, sort_keys=True)
        print(f"\nwrote {args.out} ({len(rows)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
