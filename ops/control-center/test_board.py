"""Tests for board.py using temporary fixture files. Run: python3 -m unittest test_board  (from this dir)"""
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
import board


def _w(root, name, payload, age_s=0, raw=None):
    d = Path(root) / name
    d.mkdir()
    f = d / "latest.json"
    f.write_text(raw if raw is not None else json.dumps(payload))
    t = time.time() - age_s
    os.utime(f, (t, t))


class BoardTest(unittest.TestCase):
    def test_grouping_priority_retired_parse_error(self):
        with tempfile.TemporaryDirectory() as r:
            _w(r, "zeta", {"status": "error", "summary": "x"})
            _w(r, "op_budget", {"status": "degraded"})
            _w(r, "loop-money", {"status": "alert"})
            _w(r, "okay", {"status": "ok", "alert": False})
            _w(r, "noisy", {"status": "ok", "alert": True})
            _w(r, "gone", {"status": "error", "retired": True})
            _w(r, "old", {"status": "ok"}, age_s=49 * 3600)
            _w(r, "slow", {"status": "ok", "interval_seconds": 100}, age_s=400)
            _w(r, "fresh_custom", {"status": "ok", "interval_seconds": 100}, age_s=200)
            _w(r, "broken", None, raw="{not json")
            b = board.build_board(Path(r), ["op_budget", "loop-*"])
            self.assertEqual([x["name"] for x in b["faults"]], ["op_budget", "loop-money", "broken", "zeta"])
            self.assertEqual([x["name"] for x in b["stale"]], ["old", "slow"])
            self.assertEqual([x["name"] for x in b["info"]], ["noisy"])
            self.assertEqual(b["counts"], {"faults": 4, "needs_you": 0, "stale": 2, "info": 1, "retired_hidden": 1})
            self.assertIn("JSONDecodeError", b["faults"][2]["summary"])

    def test_missing_config_alphabetical_with_warning(self):
        with tempfile.TemporaryDirectory() as r:
            _w(r, "b", {"status": "error"})
            _w(r, "a", {"status": "error"})
            board.PRIORITY_FILE = Path(r) / "nope.json"
            board._warned_missing = False
            with self.assertLogs("board", level="WARNING"):
                b = board.build_board(Path(r))
            self.assertEqual([x["name"] for x in b["faults"]], ["a", "b"])

    def test_collapse_inbox(self):
        items = [
            {"id": "1", "title": "Sensor 12 failed at 0xdeadbeef", "ts": "2026-11-05T10:00:00+00:00", "count": 2, "severity": "warn", "state": "unread"},
            {"id": "2", "title": "Sensor 7 failed at 0xabc123", "ts": "2026-11-05T12:00:00+00:00", "severity": "crit", "state": "ack"},
            {"id": "3", "title": "Different thing", "ts": "2026-11-05T11:00:00+00:00"},
        ]
        g = board.collapse_inbox(items)
        self.assertEqual(len(g), 2)
        self.assertEqual(g[0]["title"], "Sensor # failed at #")
        self.assertEqual((g[0]["count"], g[0]["last_seen"], g[0]["severity"]), (3, "2026-11-05T12:00:00+00:00", "crit"))


class RulesTest(unittest.TestCase):
    def test_rules_reclassify_but_require_a_reason(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for name in ("good_news", "owner", "broken", "no_reason"):
                (root / name).mkdir()
                (root / name / "latest.json").write_text(json.dumps({"status": "alert", "alert": True, "summary": "x"}))
            cfg = root / "cfg.json"
            cfg.write_text(json.dumps({"rules": {"good_news": {"as": "info", "why": "event"},
                                                 "owner": {"as": "needs_you", "why": "keys"},
                                                 "no_reason": {"as": "info"}}}))
            b = board.build_board(root, priority=[], rules=board.load_rules(cfg))
            self.assertEqual({r["name"] for r in b["faults"]}, {"broken", "no_reason"})
            self.assertEqual([r["name"] for r in b["info"]], ["good_news"])
            self.assertEqual([r["name"] for r in b["needs_you"]], ["owner"])


if __name__ == "__main__":
    unittest.main()
