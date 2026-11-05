#!/usr/bin/env python3
"""Negative-control tests for the yield-series seeding in provenance_snapshot.py.

The TIME moat is only worth anything if the committed archive never gets poisoned
by a junk upstream reading and compounds append-only. These prove the two pure
pieces the cron added for /defi/yields:

  - select_top_yields: TVL-ranked, finite-APY, stable-poolId only; junk skipped.
  - tick_series: starts a record on first sight, appends on later runs, caps.

Run:  python3 -I tests/test_provenance_snapshot.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import provenance_snapshot as P  # noqa: E402

pass_ = 0
fail = []


def check(name, cond):
    global pass_
    if cond:
        pass_ += 1
    else:
        fail.append(name)


# --- select_top_yields -----------------------------------------------------
pools = [
    {"pool": "big", "tvlUsd": 1_000_000, "apy": 5.0},
    {"pool": "mid", "tvlUsd": 500_000, "apy": 12.5},
    {"pool": "small", "tvlUsd": 1_000, "apy": 99.0},
    # junk rows that must be skipped — never seed a tick
    {"pool": "no-apy", "tvlUsd": 900_000, "apy": None},
    {"pool": "", "tvlUsd": 800_000, "apy": 3.0},          # empty poolId
    {"tvlUsd": 700_000, "apy": 3.0},                        # missing poolId
    {"pool": "no-tvl", "apy": 3.0},                         # missing tvl -> unranked/skipped
    {"pool": "bool-apy", "tvlUsd": 600_000, "apy": True},   # bool is not a real apy
    {"pool": "bool-tvl", "tvlUsd": True, "apy": 4.0},       # bool is not a real tvl
]
sel = P.select_top_yields(pools, 10)
check("picks only clean pools", set(sel) == {"big", "mid", "small"})
check("values are floats", all(isinstance(v, float) for v in sel.values()))
check("mid apy preserved", sel["mid"] == 12.5)

# ranking: top_n caps by TVL desc
top2 = P.select_top_yields(pools, 2)
check("top_n=2 keeps the two highest-TVL clean pools", set(top2) == {"big", "mid"})
check("top_n=2 drops the small pool", "small" not in top2)

# empty / malformed upstream degrades to {}
check("empty pools -> {}", P.select_top_yields([], 5) == {})
check("all-junk -> {}", P.select_top_yields([{"pool": "x"}, {"apy": 1.0}], 5) == {})


# --- tick_series -----------------------------------------------------------
arch = {"schema": 1, "series": {}, "generated_at": None}
n1 = P.tick_series(arch, "yield", {"big": 5.0, "mid": 12.5}, 1000)
check("first run ticks both", n1 == 2)
check("first_seen set on new record", arch["series"]["yield"]["big"]["first_seen"] == 1000)
check("one tick after first run", len(arch["series"]["yield"]["big"]["ticks"]) == 1)

n2 = P.tick_series(arch, "yield", {"big": 6.0, "mid": 11.0}, 2000)
check("second run appends", n2 == 2)
check("big now has 2 ticks", len(arch["series"]["yield"]["big"]["ticks"]) == 2)
check("first_seen unchanged across runs", arch["series"]["yield"]["big"]["first_seen"] == 1000)
check("newest tick value appended", arch["series"]["yield"]["big"]["ticks"][-1]["v"] == 6.0)

# cap bounds the record size
for i in range(P.TICK_CAP + 10):
    P.tick_series(arch, "yield", {"big": float(i)}, 3000 + i)
check("record capped at TICK_CAP", len(arch["series"]["yield"]["big"]["ticks"]) == P.TICK_CAP)
check("cap keeps newest ticks", arch["series"]["yield"]["big"]["ticks"][-1]["v"] == float(P.TICK_CAP + 10 - 1))

# a brand-new series key is created on demand (price + yield coexist)
P.tick_series(arch, "price", {"bitcoin": 42000.0}, 5000)
check("independent series coexist", set(arch["series"]) == {"yield", "price"})


print(f"test_provenance_snapshot: {pass_} passed, {len(fail)} failed")
if fail:
    for f in fail:
        print("  FAIL:", f)
    sys.exit(1)
