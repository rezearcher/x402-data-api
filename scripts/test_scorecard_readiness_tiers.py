#!/usr/bin/env python3
"""Offline regression: scorecard directory-readiness copy must be SEVERITY-AWARE.

A soft-only (quality-polish) result must NOT be sold as a "blocker that would fail"
— that is the Claims-Law oversell the live /scan/mcp/preview teaser already fixed.
These assertions pin the three tiers (ready / needs_polish / likely_reject) plus the
legacy degrade path so the public SEO pages stay consistent with the live teaser.

Run: python3 scripts/test_scorecard_readiness_tiers.py
"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("gmc", "scripts/gen_mcp_scorecards.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

FAILS = []


def check(name, cond, msg):
    if not cond:
        FAILS.append(f"[{name}] {msg}")


def line(dr):
    return m.readiness_line({"directory_readiness": dr})


# 1. ready
r = line({"ready": True, "blocker_count": 0, "hard_blockers": 0, "soft_blockers": 0, "status": "ready"})
check("ready", "readiness: ready." in r, "ready tier lost its wording")
check("ready", "likely" not in r and "blocker" not in r, "ready tier should not mention blockers")

# 2. needs_polish (soft only, zero hard) — the oversell guard
r = line({"ready": False, "blocker_count": 6, "hard_blockers": 0, "soft_blockers": 6, "status": "needs_polish"})
check("needs_polish", "quality item(s) to polish" in r, "soft-only must read as polish")
check("needs_polish", "No hard rejects" in r, "soft-only must say no hard rejects")
check("needs_polish", "would likely fail" not in r and "likely reject" not in r,
      "OVERSELL: soft-only must not claim it would fail/reject")
check("needs_polish", "6" in r, "soft count must surface")

# 3. likely_reject (has hard) — honest expensive-rejection framing
r = line({"ready": False, "blocker_count": 3, "hard_blockers": 2, "soft_blockers": 1, "status": "likely_reject"})
check("likely_reject", "2 likely reject(s)" in r, "hard count must lead")
check("likely_reject", "would likely fail" in r, "hard tier must keep the fail framing")
check("likely_reject", "plus 1 quality item(s) to polish" in r, "mixed should mention soft too")

# 4. likely_reject, no soft
r = line({"ready": False, "blocker_count": 2, "hard_blockers": 2, "soft_blockers": 0, "status": "likely_reject"})
check("reject_nosoft", "2 likely reject(s)" in r, "hard count must lead")
check("reject_nosoft", "plus" not in r, "no soft -> no 'plus' clause")

# 5. legacy payload (no hard/soft keys) degrades without claiming fail
r = line({"ready": False, "blocker_count": 4})
check("legacy", "item(s) to review" in r, "legacy must degrade to neutral 'to review'")
check("legacy", "would likely fail" not in r, "legacy must not overclaim fail")

if FAILS:
    print("FAIL:")
    for f in FAILS:
        print("  " + f)
    sys.exit(1)
print("OK — scorecard readiness tiers severity-aware (5 scenarios, 14 assertions)")
