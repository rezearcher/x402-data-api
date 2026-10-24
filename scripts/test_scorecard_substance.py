#!/usr/bin/env python3
"""Deterministic unit test for the scorecard substance floor (anti-thin-content guard
in gen_mcp_scorecards._has_substance). No network. Run: python3 -I scripts/test_scorecard_substance.py

Locks the rule that decides whether a discovered MCP server earns a crawlable scorecard
page: it must advertise one named+described tool (desc >= 20 chars) OR two distinctly
named tools. A single bare, undescribed tool name is ~all-boilerplate and is skipped so
the whole Pages site is not exposed to Google's scaled-content-abuse de-rank.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("gms", os.path.join(HERE, "gen_mcp_scorecards.py"))
gms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gms)
has_substance = gms._has_substance

CASES = [
    ([], False, "empty list (fetch failed) -> skip, degrade-open"),
    ([{"name": "x"}], False, "one bare undescribed name -> thin, skip"),
    ([{"name": "x", "description": "short"}], False, "one short (<20 char) desc -> thin"),
    ([{"name": "read_idea", "description": "Read one canonical Actwise context resource"}],
     True, "one named + real description -> publish"),
    ([{"name": "a"}, {"name": "b"}], True, "two distinctly named tools -> publish"),
    ([{"name": "a"}, {"name": "a"}], False, "two identical names -> one distinct, skip"),
    ([{"name": ""}, {"name": ""}], False, "two empty names -> skip"),
    (["notadict", None], False, "non-dict entries ignored -> skip"),
    ([{"name": "do_thing", "description": "x" * 19}], False, "desc exactly 19 chars -> below floor"),
    ([{"name": "do_thing", "description": "x" * 20}], True, "desc exactly 20 chars -> at floor, publish"),
]


def main():
    ok = 0
    for tl, exp, lbl in CASES:
        got = has_substance(tl)
        tag = "PASS" if got == exp else "FAIL"
        if got == exp:
            ok += 1
        print(f"  {tag} {lbl}: got={got} exp={exp}")
    print(f"{ok}/{len(CASES)} substance-floor cases pass")
    sys.exit(0 if ok == len(CASES) else 1)


if __name__ == "__main__":
    main()
