#!/usr/bin/env python3
"""Regression tests for the settlement idempotency guard and the append-only journal.

Card t_4ed8918e. The bug being locked down: `settle_once.js` keyed its "refuse to run
twice" guard off `logs/cdp-settlement-tx.log`, the same file that holds the evidence and
that was rewritten on every run. Archiving evidence therefore disabled the guard, and a
rewritten log re-armed it — a second settlement ran on a one-call card (2026-10-28).

Invariants asserted here, all hermetically (temp ledger files, no network, no spend):
  * the guard blocks a route settled inside the window and clears one that is not
  * the guard FAILS CLOSED on a missing ledger, a corrupt chain, or an undateable entry
  * the window is honoured (an old entry does not block a fresh settlement)
  * init bootstraps exactly once and never rewrites an existing ledger
  * the ledger stays INSERT-only: a duplicate tx_hash is rejected
  * settle_once.js reads the ledger for idempotency and only ever appends to the log

Run: python3 tests/test_settlement_ledger_guard.py    (or pytest -q)
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(PROJECT, "scripts", "cdp_settlement_ledger.py")
SETTLE = os.path.join(PROJECT, "scripts", "settle_once.js")
ROUTE = "/chain/token-security"

REQUIRED = {
    "amount_usdc": 0.009,
    "amount_units": 9000,
    "endpoint": {"route": ROUTE, "url": "https://example.invalid" + ROUTE},
    "settled_at": "2026-10-28T06:02:47Z",
    "re_listing": {"verdict": "PENDING — not yet measured"},
    "extension_status": "processing",
}


def iso(delta_days: float = 0.0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=delta_days)).isoformat().replace("+00:00", "Z")


def run_cli(*args, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, CLI, *args], input=stdin, capture_output=True, text=True, timeout=120
    )


class LedgerGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="ledger-guard-")
        self.ledger = os.path.join(self.tmp, "cdp-settlement-2026-10-28.json")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- helpers ------------------------------------------------------------
    def append(self, **overrides) -> subprocess.CompletedProcess:
        entry = dict(REQUIRED)
        entry["tx_hash"] = "0x" + os.urandom(32).hex()  # distinct unless the test says otherwise
        entry.update(overrides)
        return run_cli("append", "--file", self.ledger, "--entry", json.dumps(entry))

    def guard(self, route: str = ROUTE, *extra: str) -> subprocess.CompletedProcess:
        return run_cli("guard", "--route", route, "--file", self.ledger, *extra)

    # -- the guard ----------------------------------------------------------
    def test_blocks_route_settled_inside_window(self) -> None:
        self.assertEqual(self.append().returncode, 0)
        r = self.guard()
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("GUARD: BLOCKED", r.stdout)
        self.assertIn(f"route={ROUTE}", r.stdout)
        # the refusal must name the entry that blocks it — evidence, not a mystery
        self.assertIn("tx=0x", r.stdout)

    def test_clears_route_never_settled(self) -> None:
        self.assertEqual(self.append().returncode, 0)
        r = self.guard("/gate/swap")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("GUARD: CLEAR", r.stdout)

    def test_window_excludes_old_entry(self) -> None:
        self.assertEqual(self.append(settled_at=iso(40)).returncode, 0)
        self.assertEqual(self.guard().returncode, 0, "an entry 40 days old must not block a 25-day window")

    def test_fails_closed_on_nan_window(self) -> None:
        self.assertEqual(self.append().returncode, 0)
        r = run_cli("guard", "--route", ROUTE, "--file", self.ledger, "--window-days", "nan")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("reason=bad_window_days", r.stdout)

    def test_fails_closed_when_ledger_file_missing(self) -> None:
        missing = os.path.join(self.tmp, "not-there.json")
        r = run_cli("guard", "--route", ROUTE, "--file", missing)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("reason=ledger_missing", r.stdout)

    def test_fails_closed_when_ledger_dir_empty(self) -> None:
        fake = os.path.join(self.tmp, "fresh")
        os.makedirs(os.path.join(fake, "scripts"))
        shutil.copy(CLI, os.path.join(fake, "scripts", "cdp_settlement_ledger.py"))
        r = subprocess.run(
            [sys.executable, os.path.join(fake, "scripts", "cdp_settlement_ledger.py"), "guard", "--route", ROUTE],
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("reason=no_ledger_files", r.stdout)

    def test_fails_closed_when_chain_is_corrupt(self) -> None:
        self.assertEqual(self.append().returncode, 0)
        self.assertEqual(self.append().returncode, 0)
        with open(self.ledger, encoding="utf-8") as fh:
            doc = json.load(fh)
        doc["entries"][0]["amount_usdc"] = 999.0  # retroactive edit
        with open(self.ledger, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2)
        r = self.guard()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("reason=ledger_untrustworthy", r.stdout)
        self.assertIn("entry was modified", r.stdout)

    def test_undateable_entry_is_treated_as_inside_window(self) -> None:
        self.assertEqual(self.append(settled_at="whenever").returncode, 0)
        self.assertEqual(self.guard().returncode, 2, "an entry with no usable timestamp must fail closed")

    # -- the ledger stays INSERT-only ---------------------------------------
    def test_duplicate_tx_hash_rejected(self) -> None:
        tx = "0x" + "a" * 64
        self.assertEqual(self.append(tx_hash=tx).returncode, 0)
        r = self.append(tx_hash=tx)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("already in the ledger", r.stdout + r.stderr)

    def test_init_bootstraps_once_and_never_overwrites(self) -> None:
        self.assertEqual(run_cli("init", "--file", self.ledger).returncode, 0)
        self.assertEqual(run_cli("verify", "--file", self.ledger).returncode, 0)
        r = run_cli("init", "--file", self.ledger)
        self.assertEqual(r.returncode, 1)
        self.assertIn("already exists", r.stdout)

    def test_append_requires_the_card_fields(self) -> None:
        r = run_cli("append", "--file", self.ledger, "--entry", json.dumps({"tx_hash": "0xdead"}))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("missing required field", r.stdout + r.stderr)


class SettleOnceWiringTests(unittest.TestCase):
    """Static checks on settle_once.js: the coupling that caused the bug must be gone."""

    @classmethod
    def setUpClass(cls) -> None:
        with open(SETTLE, encoding="utf-8") as fh:
            cls.src = fh.read()

    def test_guard_no_longer_greps_the_log(self) -> None:
        self.assertIsNone(
            re.search(r"readFileSync\(\s*LOG_PATH", self.src),
            "settle_once.js must not read the log to decide idempotency",
        )
        self.assertNotIn("contains settlement_confirmed", self.src)

    def test_guard_calls_the_ledger_cli(self) -> None:
        self.assertIn("cdp_settlement_ledger.py", self.src)
        self.assertRegex(self.src, r"\[\s*LEDGER_CLI\s*,\s*'guard'")
        self.assertIn("--window-days", self.src)

    def test_guard_is_fail_closed(self) -> None:
        # only exit 0 proceeds; exit 2 = already settled; everything else refuses
        self.assertRegex(self.src, r"r\.status\s*===\s*2")
        self.assertRegex(self.src, r"r\.status\s*!==\s*0")
        self.assertIn("fail closed", self.src)

    def test_log_is_append_only(self) -> None:
        self.assertRegex(self.src, r"appendFileSync\([^)]*LOG_APPEND")
        self.assertRegex(self.src, r"LOG_APPEND\s*=\s*\{\s*flags:\s*'a'")
        # no truncating write may target the log (prose may say "truncate"; code may not)
        self.assertIsNone(re.search(r"writeFileSync\(\s*LOG_PATH", self.src))
        self.assertIsNone(re.search(r"truncateSync|fs\.truncate\(", self.src))
        self.assertIsNone(re.search(r"openSync\(\s*LOG_PATH\s*,\s*'w", self.src))

    def test_success_appends_a_ledger_entry(self) -> None:
        self.assertIn("ledgerAppend(ledgerFile, ledgerEntry)", self.src)
        for field in ("tx_hash", "amount_usdc", "endpoint", "settled_at", "re_listing", "extension_status"):
            self.assertIn(field, self.src)
        self.assertIn("settlement_unledgered", self.src)
        self.assertRegex(self.src, r"process\.exit\(3\)")


class JournalIsAppendOnlyTests(unittest.TestCase):
    def test_verify_settlement_tx_confirms_per_tx_not_per_file(self) -> None:
        path = os.path.join(PROJECT, "scripts", "verify_settlement_tx.js")
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("confirmedTxs", src, "the verifier must key confirmation on tx=<hash>")
        self.assertNotRegex(
            src,
            r"lines\.some\(\(l\)\s*=>\s*l\.includes\('settlement_confirmed'\)\)",
            "an append-only log can never satisfy a whole-file confirmation check",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
