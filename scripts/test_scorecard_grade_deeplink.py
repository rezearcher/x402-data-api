#!/usr/bin/env python3
"""Offline regression: the leaderboard Grade cell must deep-link to the per-server
claim/fix CTA (#claim anchor), and must degrade open to plain text when there is no
grade (so a carried-forward row never becomes a dead link).

The grade is the cell a server owner reacts to, so it is the highest-intent entry
into the free-badge claim + $9.99/mo fix path. These assertions pin that behaviour.

Run: python3 scripts/test_scorecard_grade_deeplink.py
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


PAGE = "mcp-deepwiki-mcp-security.html"

# 1. a real grade links to the #claim anchor on its own page
r = m.grade_cell_link("A", PAGE)
check("grade-A", r == f"[A]({PAGE}#claim)", f"A grade must deep-link to #claim, got {r!r}")
r = m.grade_cell_link("C", PAGE)
check("grade-C", r == f"[C]({PAGE}#claim)", f"C grade must deep-link to #claim, got {r!r}")
r = m.grade_cell_link("F", PAGE)
check("grade-F", r == f"[F]({PAGE}#claim)", f"F grade must deep-link to #claim, got {r!r}")

# 2. em-dash placeholder (no grade yet) stays plain text — never a dead link
r = m.grade_cell_link("—", PAGE)
check("dash", r == "—", f"em-dash placeholder must stay plain text, got {r!r}")

# 3. empty / whitespace / None all degrade open to plain text
check("empty", m.grade_cell_link("", PAGE) == "", "empty grade must pass through")
check("ws", m.grade_cell_link("  ", PAGE) == "  ", "whitespace grade must pass through")
check("none", m.grade_cell_link(None, PAGE) is None, "None grade must pass through")

# 4. the anchor the link targets exists on the rendered per-server page heading
#    (kramdown {#claim} attribute on the claim/badge section)
body, _ = m.render(
    "DeepWiki", "deepwiki", "https://mcp.deepwiki.com/mcp", "vendor",
    {"verdict": "clear", "tools_scanned": 3, "issue_count": 0,
     "directory_readiness": {"ready": True, "blocker_count": 0,
                             "hard_blockers": 0, "soft_blockers": 0, "status": "ready"},
     "_tools": [{"name": "ask", "description": "Ask a question about a repo wiki page."}],
     "_instructions": ""},
    "2026-10-27")
check("anchor", "{#claim}" in body, "per-server claim heading must carry the {#claim} anchor")

if FAILS:
    print("FAIL:")
    for f in FAILS:
        print("  " + f)
    sys.exit(1)
print("OK: grade deep-link + #claim anchor (8 assertions)")
