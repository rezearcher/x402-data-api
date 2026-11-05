#!/usr/bin/env python3
"""Negative-control tests for the buyer-facing /status correctness block.

Proves the block tells the truth in every state: PASSES on a healthy fresh sensor, reports
'regressed' when a canary is False, downgrades to 'inconclusive' when the sensor is STALE (so a
stalled probe can never assert a stale 'passing'), and OMITS the block (degrade-open) when the
sensor file is missing. A trust surface that only ever says 'passing' is theatre.
Run: python3 tests/test_status_correctness.py
"""
import datetime
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
from status_correctness import correctness_block, CORRECTNESS_GUARDS  # noqa: E402

checks = []


def expect(name, got, want):
    checks.append((name, got == want, got, want))


NOW = datetime.datetime(2026, 11, 5, 12, 40, tzinfo=datetime.UTC)
ALL_KEYS = {k for (k, _) in CORRECTNESS_GUARDS.values()}


def _sensor(fetched_at, **overrides):
    base = {k: True for k in ALL_KEYS}
    base.update(overrides)
    base["fetched_at"] = fetched_at
    fd, p = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    json.dump(base, open(p, "w"))
    return p


# 1) Healthy + fresh -> every route passing, all_passing True.
p = _sensor("2026-11-05T12:35:01Z")
b = correctness_block(p, now=NOW)
expect("fresh.all_passing", b["all_passing"], True)
expect("fresh.fresh", b["fresh"], True)
expect("fresh.yields_passing", b["checks"]["/defi/yields"]["status"], "passing")
expect("fresh.routes", len(b["checks"]), len(CORRECTNESS_GUARDS))
os.unlink(p)

# 2) A canary is False -> that route reads 'regressed' and all_passing drops.
p = _sensor("2026-11-05T12:35:01Z", gate_detection_ok=False)
b = correctness_block(p, now=NOW)
expect("regress.gate", b["checks"]["/gate/swap"]["status"], "regressed")
expect("regress.all_passing", b["all_passing"], False)
expect("regress.other_route_still_passing", b["checks"]["/defi/yields"]["status"], "passing")
os.unlink(p)

# 3) A canary is None (probe inconclusive) -> 'inconclusive', never a false alarm.
p = _sensor("2026-11-05T12:35:01Z", prices_detection_ok=None)
b = correctness_block(p, now=NOW)
expect("inconclusive.prices", b["checks"]["/crypto/prices"]["status"], "inconclusive")
os.unlink(p)

# 4) STALE sensor (>2h old) -> EVERY check inconclusive even though the values say True.
p = _sensor("2026-11-05T08:00:00Z")  # 4h40m before NOW
b = correctness_block(p, now=NOW)
expect("stale.fresh", b["fresh"], False)
expect("stale.all_inconclusive", all(c["status"] == "inconclusive" for c in b["checks"].values()), True)
expect("stale.all_passing_false", b["all_passing"], False)
os.unlink(p)

# 5) Missing sensor file -> block omitted entirely (degrade-open, backward-compatible).
expect("missing.omitted", correctness_block("/nonexistent/path/sensor.json", now=NOW), None)

# 6) Guard descriptions are present and non-empty for every route (buyer-readable).
p = _sensor("2026-11-05T12:35:01Z")
b = correctness_block(p, now=NOW)
expect("guards.all_nonempty", all(len(c["guards"]) > 10 for c in b["checks"].values()), True)
os.unlink(p)

fails = [c for c in checks if not c[1]]
for name, ok, got, want in checks:
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"  got={got!r} want={want!r}"))
print(f"\n{len(checks) - len(fails)}/{len(checks)} passed")
sys.exit(1 if fails else 0)
