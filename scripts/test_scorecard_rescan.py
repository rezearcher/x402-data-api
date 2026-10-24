#!/usr/bin/env python3
"""Offline unit tests for select_stale_rescan — the scorecard freshness-rotation
selector. No network: validates stalest-first ordering, done-slug exclusion,
url-required filter, limit, and missing-date = maximally-stale, deterministically."""
import importlib.util
import pathlib
import sys

_spec = importlib.util.spec_from_file_location(
    "gen_mcp_scorecards", pathlib.Path(__file__).with_name("gen_mcp_scorecards.py"))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
select = _mod.select_stale_rescan


def _card(slug, scanned, url="https://h/mcp"):
    return {"slug": slug, "name": slug, "url": url, "scanned": scanned}


def _state(cards):
    return {c["slug"]: c for c in cards}


FAILS = []


def check(name, cond):
    print(("PASS" if cond else "FAIL") + "  " + name)
    if not cond:
        FAILS.append(name)


# 1. empty / zero-limit guards
check("empty state -> []", select({}, set(), 20) == [])
check("limit 0 -> []", select(_state([_card("a", "2026-01-01")]), set(), 0) == [])
check("negative limit -> []", select(_state([_card("a", "2026-01-01")]), set(), -5) == [])

# 2. stalest first (oldest scanned date ascending)
st = _state([_card("new", "2026-10-20"), _card("old", "2026-01-01"),
             _card("mid", "2026-06-15")])
order = [c["slug"] for c in select(st, set(), 10)]
check("stalest-first ordering", order == ["old", "mid", "new"])

# 3. limit respected (take the N stalest only)
check("limit caps to N stalest", [c["slug"] for c in select(st, set(), 2)] == ["old", "mid"])

# 4. done_slugs excluded (discovery/curated already scanned this run win)
check("done_slug excluded", [c["slug"] for c in select(st, {"old"}, 10)] == ["mid", "new"])

# 5. cards without a usable http url are skipped (nothing live to re-scan)
st2 = _state([_card("hasurl", "2026-01-01"), _card("nourl", "2026-01-01", url=""),
              _card("badurl", "2026-01-01", url="ftp://x")])
check("url-required filter", [c["slug"] for c in select(st2, set(), 10)] == ["hasurl"])

# 6. missing/blank scanned date sorts OLDEST (maximally stale), slug tie-break
st3 = _state([_card("dated", "2026-05-01"), _card("nodate", None),
              _card("blank", "")])
order3 = [c["slug"] for c in select(st3, set(), 10)]
check("missing date is maximally stale", order3 == ["blank", "nodate", "dated"])

# 7. none left after exclusion -> []
check("all excluded -> []", select(st, {"new", "old", "mid"}, 10) == [])

print()
if FAILS:
    print(f"{len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("all scorecard-rescan tests passed")
