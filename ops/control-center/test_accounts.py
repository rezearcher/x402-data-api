"""Tests for the ACCOUNT BALANCE backend in state_builder.py. Run: python3 -m unittest test_accounts (from this dir)"""
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
import state_builder as sb


def _w(root, name, payload, age_s=0):
    d = Path(root) / name
    d.mkdir()
    f = d / "latest.json"
    f.write_text(json.dumps(payload))
    t = time.time() - age_s
    os.utime(f, (t, t))


class AccountsTest(unittest.TestCase):
    def setUp(self):
        self._data = sb.DATA

    def tearDown(self):
        sb.DATA = self._data

    def test_discovers_venues_live_first_and_ignores_other_sensors(self):
        with tempfile.TemporaryDirectory() as r:
            _w(r, "midas_alpaca", {"status": "ok", "account_summary": {"venue": "alpaca", "label": "Alpaca", "kind": "paper", "total_usd": 5.0}})
            _w(r, "kalshi_account", {"status": "ok", "account_summary": {"venue": "kalshi", "label": "Kalshi", "kind": "live", "total_usd": 172.39}})
            _w(r, "unrelated", {"status": "ok", "summary": "no account here"})
            sb.DATA = Path(r)
            a = sb.accounts()
            self.assertEqual([x["venue"] for x in a], ["kalshi", "alpaca"])
            self.assertFalse(a[0]["stale"])

    def test_stale_and_error_status_are_loud_not_zero(self):
        with tempfile.TemporaryDirectory() as r:
            _w(r, "kalshi_account", {"status": "error", "reason": "STALE since X - network: boom",
                                     "account_summary": {"venue": "kalshi", "kind": "live", "total_usd": 172.39}}, age_s=7 * 3600)
            sb.DATA = Path(r)
            a = sb.accounts()[0]
            self.assertTrue(a["stale"])
            self.assertEqual(a["total_usd"], 172.39)          # last-good kept, never invented as 0
            self.assertTrue(any("sensor status=error" in e for e in a["errors"]))
            self.assertTrue(any("old" in e for e in a["errors"]))

    def test_unparseable_summary_becomes_error_row(self):
        with tempfile.TemporaryDirectory() as r:
            d = Path(r) / "bad"
            d.mkdir()
            (d / "latest.json").write_text('{"account_summary": ')
            sb.DATA = Path(r)
            a = sb.accounts()
            self.assertEqual(len(a), 1)           # surfaced as a loud error row, not dropped, not a 0 balance
            self.assertIsNone(a[0]["total_usd"])
            self.assertTrue(a[0]["stale"] and "unreadable" in a[0]["errors"][0])

    def test_revenue_without_oracle_is_none_not_zero(self):
        rv = sb.revenue({"is_x402": False, "oracle": None, "revdir": None})
        self.assertIsNone(rv["balance_usd"])
        self.assertIn("no oracle_file", rv["revenue_error"])

    def test_revenue_with_unreadable_oracle_reports_cause(self):
        rv = sb.revenue({"is_x402": False, "oracle": Path("/nonexistent/oracle.json"), "revdir": None})
        self.assertIsNone(rv["balance_usd"])
        self.assertTrue(rv["revenue_error"])

    def test_revenue_with_real_oracle_still_works(self):
        with tempfile.TemporaryDirectory() as r:
            f = Path(r) / "o.json"
            f.write_text(json.dumps({"balance_usd": 12.5, "metered_invocations": 3}))
            rv = sb.revenue({"is_x402": False, "oracle": f, "revdir": None})
            self.assertEqual(rv["balance_usd"], 12.5)
            self.assertIsNone(rv["revenue_error"])


if __name__ == "__main__":
    unittest.main()
