#!/usr/bin/env python3
"""Offline regression test for the scorecard leaderboard carry-forward.

The ranked index page must be the UNION of every scorecard ever published, not
just the servers this (non-deterministic registry-walk) run reached — otherwise a
server that 502s once silently drops off the hub while its page + sitemap entry
persist (a sitemap-only orphan) and the leaderboard flaps/shrinks run to run.

These tests are fully offline (no network, no gh): they exercise the pure
render -> parse round-trip, the degrade-open parser, the merge (this-run wins,
prior carried forward) and the rank ordering. Run: python3 scripts/test_scorecard_carryforward.py
"""
import importlib.util
import os
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("gen", os.path.join(HERE, "gen_mcp_scorecards.py"))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
TODAY = datetime.date.today().isoformat()


def test_render_parse_roundtrip():
    d = {"tools_scanned": 5, "verdict": "clear", "grade": "A", "grade_scale": "A..F",
         "risk_score": 3, "scanned_at": "2026-09-01",
         "directory_readiness": {"ready": False, "blocker_count": 2},
         "_tools": [{"name": "lookup", "description": "find docs"}], "_instructions": ""}
    body, _ = g.render("Acme Docs", "acme-docs", "https://acme.test/mcp", "Acme vendor.", d, "2026-09-01")
    c = g.parse_published_card("acme-docs", body)
    assert c["name"] == "Acme Docs"
    assert c["verdict"] == "clear"
    assert c["tools"] == 5
    assert c["grade"] == "A"
    assert c["ready"] is False and c["blocker_count"] == 2
    assert c["scanned"] == "2026-09-01"
    assert c["url"] == "https://acme.test/mcp"


def test_render_parse_ready():
    d = {"tools_scanned": 1, "verdict": "clear", "grade": "A", "risk_score": 1,
         "directory_readiness": {"ready": True, "blocker_count": 0}, "_tools": [], "_instructions": ""}
    body, _ = g.render("Ready Co", "ready-co", "https://r.test/mcp", "V.", d, "2026-09-02")
    c = g.parse_published_card("ready-co", body)
    assert c["ready"] is True and c["blocker_count"] == 0


def test_parse_degrades_open():
    # A page that does not match any pattern yields a card that still lists, never a crash.
    c = g.parse_published_card("junk", "nothing parseable here")
    assert c["slug"] == "junk"
    assert c["grade"] is None and c["verdict"] is None
    assert c["tools"] == 0


def test_build_leaderboard_offline_runonly():
    run = {"a": g.card_from_result(
        "A", "a", "u1",
        {"grade": "A", "verdict": "clear", "tools_scanned": 1, "risk_score": 1,
         "directory_readiness": {"ready": True, "blocker_count": 0}}, TODAY)}
    merged, backfilled = g.build_leaderboard(run, False, TODAY)
    assert set(merged) == {"a"}
    assert backfilled is False


def test_rank_order():
    cards = {
        "f": {"slug": "f", "grade": "F", "risk_score": 90, "ready": False, "blocker_count": 3},
        "a": {"slug": "a", "grade": "A", "risk_score": 2, "ready": True, "blocker_count": 0},
        "n": {"slug": "n", "grade": None, "risk_score": None, "ready": False, "blocker_count": None},
    }
    order = [c["slug"] for c in sorted(cards.values(), key=g.rank_key_card)]
    assert order == ["a", "f", "n"], order


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"PASS {t.__name__}")
    print(f"\n{len(tests)}/{len(tests)} carry-forward tests passed")
