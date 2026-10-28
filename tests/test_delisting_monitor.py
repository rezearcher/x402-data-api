#!/usr/bin/env python3
"""Regression tests for the re-keyed CDP delisting monitor (card t_3814c750).

The bug these lock down is a *measurement* bug, not a code crash: the 30-day
delisting rule was monitored off `min(quality.lastCalledAt)`, a field CDP writes
from a delayed rollup. A 259-record census of the public catalog
(logs/cdp-counter-census-2026-10-28.json) puts 89.6% of records within 60 s of
their `lastUpdated`, but the tail is unbounded — p95 1.6 h, max 9.8 days — and our
own /chain/token-security sat frozen for >95 min after a *successful* settlement.
A monitor on that field therefore fires falsely (and pressures an operator into
paying 0.009 USDC to unstick a counter that no payment is known to move) while
saying nothing trustworthy about the actual 30-day clock.

Invariants asserted here, all hermetic (no network, no settle, no spend):

  * the gate is `lastUpdated`, the field that moves per settled call;
  * a stale counter never changes a status in either direction;
  * a record with no parseable lastUpdated is UNKNOWN, not silently OK;
  * status boundaries land on the documented 25/28/30-day lines;
  * the aggregate exit code is the worst route (and NO-DATA when there is nothing);
  * the ledger cross-check keys on (host, route) so our two /chain/token-report
    records on two hosts are never cross-annotated;
  * no remediation string ever tells an operator to settle in order to move a
    counter, and the counter-lag path says the opposite in as many words.

Run: python3 tests/test_delisting_monitor.py    (or pytest -q)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONITOR = os.path.join(PROJECT, "scripts", "monitor_delisting.py")
sys.path.insert(0, os.path.join(PROJECT, "scripts"))

import monitor_delisting as md  # noqa: E402

NOW = datetime(2026, 10, 28, 9, 0, 0, tzinfo=timezone.utc)
ISO = "%Y-%m-%dT%H:%M:%S.%f"


def iso(dt):
    return dt.strftime(ISO)[:-3] + "Z"


def record(resource="https://x402-data-api.sigrunner.workers.dev/chain/token-security",
           updated_days_ago=0.0, called_days_ago=0.0, calls=9, payers=2, updated=None, called=None):
    """A catalog record with the two clocks set independently."""
    lu = updated if updated is not None else iso(NOW - timedelta(days=updated_days_ago))
    lc = called if called is not None else iso(NOW - timedelta(days=called_days_ago))
    return {
        "resource": resource,
        "lastUpdated": lu,
        "quality": {"lastCalledAt": lc, "l30DaysTotalCalls": calls, "l30DaysUniquePayers": payers},
        "description": "Detect scam, rug-pull and honeypot tokens before you buy.",
    }


class TestTimestamps(unittest.TestCase):
    def test_z_suffix_and_offsets_parse(self):
        self.assertEqual(md.ts("2026-10-28T07:14:09.743Z").hour, 7)
        self.assertEqual(md.ts("2026-10-28T07:14:09Z").tzinfo, timezone.utc)
        self.assertEqual(md.ts("2026-10-28T09:14:09+02:00").hour, 7)

    def test_fractional_seconds_beyond_microseconds(self):
        dt = md.ts("2026-10-28T07:14:09.743999999Z")
        self.assertEqual((dt.hour, dt.minute, dt.second), (7, 14, 9))

    def test_string_compare_would_have_been_wrong(self):
        """'...09.743Z' sorts before '...09Z' as a string; as instants it is later."""
        self.assertGreater(md.ts("2026-10-28T07:14:09.743Z"), md.ts("2026-10-28T07:14:09Z"))

    def test_junk_is_none_not_an_exception(self):
        for bad in ("", None, "not-a-date", "2026-13-45T00:00:00Z"):
            self.assertIsNone(md.ts(bad), bad)


class TestClassify(unittest.TestCase):
    def test_fresh_route_is_ok(self):
        v = md.classify(record(updated_days_ago=0.1, called_days_ago=0.1), NOW)
        self.assertEqual(v["status"], "OK")
        self.assertEqual(v["gate_field"], "lastUpdated")
        self.assertAlmostEqual(v["days_to_delist"], 29.9, places=2)

    def test_boundaries_hold_exactly(self):
        cases = [
            (24.999, "OK"),
            (25.0, "WARN"),
            (27.999, "WARN"),
            (28.0, "CRITICAL"),
            (29.999, "CRITICAL"),
            (30.0, "DELISTED"),
            (31.0, "DELISTED"),
        ]
        for days, want in cases:
            v = md.classify(record(updated_days_ago=days, called_days_ago=days), NOW)
            self.assertEqual(v["status"], want, f"{days}d -> {v['status']}, wanted {want}")

    def test_thresholds_are_configurable(self):
        v = md.classify(record(updated_days_ago=2.0), NOW, warn_days=1, critical_days=3, delist_days=4)
        self.assertEqual(v["status"], "WARN")

    def test_frozen_counter_does_not_change_status_THE_REGRESSION(self):
        """The card's exact shape: lastUpdated 1 h ago, counter 40 days stale.

        The old monitor keyed on min(lastCalledAt) and would have called this route
        a 40-day-old delisting emergency. Nothing about the counter is a delisting
        signal — it is a rollup that is merely slow.
        """
        v = md.classify(record(updated_days_ago=1 / 24.0, called_days_ago=40.0), NOW)
        self.assertEqual(v["status"], "OK")
        self.assertTrue(v["counter_flagged"])
        self.assertTrue(v["counter_in_tail"])
        self.assertAlmostEqual(v["counter_drift_s"], 40 * 86400 - 3600, delta=2)

    def test_fresh_counter_does_not_rescue_an_old_record(self):
        """The converse: a counter that looks fresh cannot make a 29.5-day record safe."""
        v = md.classify(record(updated_days_ago=29.5, called_days_ago=0.0), NOW)
        self.assertEqual(v["status"], "CRITICAL")
        self.assertTrue(v["counter_ahead_of_record"])

    def test_missing_lastUpdated_is_unknown_not_ok(self):
        rec = record()
        rec["lastUpdated"] = None
        v = md.classify(rec, NOW)
        self.assertEqual(v["status"], "UNKNOWN")
        self.assertIsNone(v["age_days"])
        self.assertIn("cannot measure", v["reason"])

    def test_unparseable_lastUpdated_is_unknown(self):
        rec = record()
        rec["lastUpdated"] = "yesterday"
        self.assertEqual(md.classify(rec, NOW)["status"], "UNKNOWN")

    def test_record_without_quality_block_still_classifies(self):
        rec = record()
        rec.pop("quality")
        v = md.classify(rec, NOW)
        self.assertEqual(v["status"], "OK")
        self.assertIsNone(v["counter_drift_s"])
        self.assertFalse(v["counter_flagged"])

    def test_record_stale_vs_counter_is_flagged_and_stays_pessimistic(self):
        """3/259 catalog records (ax1.vc: 154k calls/30d) have a counter DAYS ahead
        of lastUpdated. Age then under-reads freshness -- early, never late."""
        v = md.classify(record(updated_days_ago=10.0, called_days_ago=0.0), NOW)
        self.assertEqual(v["status"], "OK")
        self.assertTrue(v["record_stale_vs_counter"])
        self.assertAlmostEqual(v["age_days"], 10.0, places=3)

        just_under = md.classify(record(updated_days_ago=0.0, called=iso(NOW), updated=iso(NOW - timedelta(seconds=3599))), NOW)
        self.assertFalse(just_under["record_stale_vs_counter"])
        just_over = md.classify(record(updated=iso(NOW - timedelta(seconds=3601)), called=iso(NOW)), NOW)
        self.assertTrue(just_over["record_stale_vs_counter"])

    def test_counter_bands(self):
        bands = {
            0.0: "normal (89.6% of catalog <=60s)",
            59.0: "normal (89.6% of catalog <=60s)",
            61.0: "slow-rollup (>60s, <1h)",
            3600.0: "far-tail (>1h, under p95)",
            md.COUNTER_TAIL_SECONDS: "beyond-observed-p95",
        }
        for drift, want in bands.items():
            self.assertEqual(md._counter_band(drift), want, drift)
        self.assertEqual(md._counter_band(-90), "counter-ahead-of-record")
        self.assertEqual(md._counter_band(None), "unmeasurable")

    def test_route_extraction(self):
        self.assertEqual(
            md.route_of({"resource": "https://x402-data-api.sigrunner.workers.dev/chain/token-security"}),
            "/chain/token-security")
        self.assertEqual(md.route_of({"resource": "https://api.greyridgesignals.ai/chain/token-report"}),
                         "/chain/token-report")
        self.assertEqual(md.route_of({"resource": "https://host.example/"}).count("/"), 1)


class TestDecide(unittest.TestCase):
    def _v(self, status, route="/x"):
        return {"status": status, "route": route, "resource": "https://h" + route}

    def test_worst_wins(self):
        self.assertEqual(md.decide([self._v("OK"), self._v("WARN"), self._v("CRITICAL")]), ("CRITICAL", 2))
        self.assertEqual(md.decide([self._v("WARN"), self._v("DELISTED")]), ("DELISTED", 3))
        self.assertEqual(md.decide([self._v("OK"), self._v("OK")]), ("OK", 0))

    def test_unknown_is_critical_magnitude(self):
        self.assertEqual(md.decide([self._v("OK"), self._v("UNKNOWN")]), ("UNKNOWN", 2))

    def test_empty_feed_is_no_data_not_ok(self):
        self.assertEqual(md.decide([]), ("NO-DATA", 4))


class TestDedupe(unittest.TestCase):
    """Paging /merchant re-serves the tail of the previous page; a raw concat
    printed /ai/extract twice and inflated the route count."""

    def test_keeps_newest_lastUpdated_per_resource(self):
        old = record(updated_days_ago=9.0)
        new = record(updated_days_ago=1.0)
        self.assertEqual(len(md.dedupe([old, new])), 1)
        self.assertAlmostEqual(md.classify(md.dedupe([new, old])[0], NOW)["age_days"], 1.0, places=2)

    def test_distinct_resources_both_survive(self):
        a = record(resource="https://h/a")
        b = record(resource="https://h/b")
        self.assertEqual(len(md.dedupe([a, b])), 2)

    def test_blank_resource_is_dropped(self):
        self.assertEqual(md.dedupe([record(resource=""), record(resource=None)]), [])


class TestRemediation(unittest.TestCase):
    def test_ok_never_tells_you_to_settle(self):
        text = md.remediation_for("OK").lower()
        self.assertIn("do not settle", text)
        self.assertNotIn("settle_once", text)

    def test_no_status_ever_invokes_the_settle_script(self):
        """settle_once.js must never be printed as the fix for anything here."""
        for status in ("OK", "WARN", "CRITICAL", "DELISTED", "UNKNOWN"):
            text = md.remediation_for(status).lower()
            self.assertNotIn("settle_once", text, status)

    def test_healthy_and_unmeasurable_statuses_never_advise_spending(self):
        for status in ("OK", "UNKNOWN"):
            text = md.remediation_for(status).lower()
            self.assertNotIn("settle once", text, status)
            self.assertNotIn("plan one settlement", text, status)

    def test_settling_paths_demand_the_description_first_and_the_guard(self):
        for status in ("WARN", "CRITICAL"):
            text = md.remediation_for(status).lower()
            self.assertIn("description", text)
            self.assertIn("guard", text)


class TestLedgerCrossCheck(unittest.TestCase):
    def _ledger(self, entries):
        fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"schema": "cdp-settlement-ledger/v1", "entries": entries}, fh)
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        return fh.name

    def test_newest_entry_per_resource_wins(self):
        path = self._ledger([
            {"settled_at": "2026-10-28T06:02:47Z",
             "endpoint": {"route": "/a", "url": "https://h.example/a", "host": "h.example"}},
            {"settled_at": "2026-10-28T07:14:11Z",
             "endpoint": {"route": "/a", "url": "https://h.example/a", "host": "h.example"}},
        ])
        got = md.ledger_last_settlements([path])
        self.assertEqual(list(got), [("h.example", "/a")])
        self.assertEqual(got[("h.example", "/a")].hour, 7)

    def test_same_route_on_two_hosts_is_not_cross_annotated(self):
        path = self._ledger([
            {"settled_at": "2026-10-28T06:58:49Z",
             "endpoint": {"route": "/chain/token-report",
                          "url": "https://api.greyridgesignals.ai/chain/token-report",
                          "host": "api.greyridgesignals.ai"}},
        ])
        ledger = md.ledger_last_settlements([path])
        workers = md.annotate_ledger(
            md.classify({"resource": "https://x402-data-api.sigrunner.workers.dev/chain/token-report",
                         "lastUpdated": iso(NOW - timedelta(days=7)),
                         "quality": {"lastCalledAt": iso(NOW - timedelta(days=7))}}, NOW), ledger)
        self.assertIsNone(workers["ledger_last_settlement"])

        other = md.annotate_ledger(
            md.classify({"resource": "https://api.greyridgesignals.ai/chain/token-report",
                         "lastUpdated": "2026-10-28T06:58:44.587Z",
                         "quality": {"lastCalledAt": "2026-10-28T06:58:48.769Z"}}, NOW), ledger)
        self.assertEqual(other["ledger_vs_catalog"], "CONSISTENT")

    def test_unreflected_settlement_is_flagged(self):
        path = self._ledger([
            {"settled_at": "2026-10-28T08:00:00Z",
             "endpoint": {"route": "/a", "url": "https://h.example/a", "host": "h.example"}},
        ])
        v = md.annotate_ledger(
            {"route": "/a", "resource": "https://h.example/a",
             "last_updated": "2026-10-27T00:00:00Z"},
            md.ledger_last_settlements([path]))
        self.assertEqual(v["ledger_vs_catalog"], "UNREFLECTED-SETTLEMENT")

    def test_catalog_newer_than_ledger_means_someone_else_called(self):
        path = self._ledger([
            {"settled_at": "2026-10-20T00:00:00Z",
             "endpoint": {"route": "/a", "url": "https://h.example/a", "host": "h.example"}},
        ])
        v = md.annotate_ledger(
            {"route": "/a", "resource": "https://h.example/a",
             "last_updated": "2026-10-28T04:06:46Z"},
            md.ledger_last_settlements([path]))
        self.assertEqual(v["ledger_vs_catalog"], "EXTERNAL-CALL-OR-REFRESH")

    def test_corrupt_ledger_is_ignored_not_fatal(self):
        fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        fh.write("{not json")
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        self.assertEqual(md.ledger_last_settlements([fh.name, "/nonexistent.json"]), {})


class TestCli(unittest.TestCase):
    """End-to-end through the real CLI: exit codes, JSON output, offline fixture."""

    def _run(self, records, *extra):
        fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"resources": records}, fh)
        fh.close()
        self.addCleanup(os.unlink, fh.name)
        out = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        out.close()
        self.addCleanup(os.unlink, out.name)
        cmd = [sys.executable, MONITOR, "--from-file", fh.name, "--now", iso(NOW),
               "--json-out", out.name, "--ledger", *extra]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        with open(out.name) as f:
            payload = json.load(f)
        return p, payload

    def test_healthy_feed_exits_zero_and_reports_counter_lag_as_advisory(self):
        p, payload = self._run([record(updated_days_ago=1 / 24.0, called_days_ago=40.0)])
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("ADVISORY", p.stdout)
        self.assertIn("do not settle", p.stdout.lower())
        self.assertEqual(payload["worst"], "OK")
        by_route = {r["route"]: r for r in payload["routes"]}
        self.assertEqual(by_route["/chain/token-security"]["status"], "OK")
        self.assertTrue(by_route["/chain/token-security"]["counter_in_tail"])

    def test_delisted_route_exits_three(self):
        p, payload = self._run([record(updated_days_ago=31.0, called_days_ago=31.0)])
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertEqual(payload["worst"], "DELISTED")
        self.assertIn("description", p.stdout.lower())

    def test_empty_feed_exits_four(self):
        p, _ = self._run([])
        self.assertEqual(p.returncode, 4, p.stdout + p.stderr)

    def test_cli_never_prints_a_settle_instruction(self):
        p, _ = self._run([record(updated_days_ago=26.0, called_days_ago=26.0)])
        self.assertEqual(p.returncode, 1)
        self.assertNotIn("settle_once", p.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
