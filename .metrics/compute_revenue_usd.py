#!/usr/bin/env python3
"""
revenue_usd producer — Double-corrected organic revenue signal.

Reads both audit sidecars (self-traffic + probe-bot) and emits the
true organic revenue figure into .metrics/revenue_usd.

Sources (read-only):
  ~/.hermes/data/<play>-revenue/ledger_verified_summary.json
  ~/.hermes/data/<play>-revenue/probe_check_summary.json

Output:
  Overwrites .metrics/revenue_usd (sibling file) with the corrected float.

OWNERSHIP NOTE (2026-10-28)
  This script used to ALSO write .metrics/revenue_usd_corrected. It no longer does:
  that metric is owned single-writer by .metrics/reconcile_live_revenue.py, which now
  computes it from BOTH rails (on-chain x402 + Stripe fiat) and persists it to the gap
  sensor. Two writers of one file meant the last cron to run silently decided the
  milestone reading — this script's ledger-sidecar basis (0.005) could clobber the
  two-rail value (0.80+) and report a flat line that was not real. See ARCHITECTURE.md
  §"two writers of the same repo file". `revenue_usd` (ledger-derived) stays here.
"""

import json
import os
import sys

DATA_BASE = os.path.expanduser("~/.hermes/data")
PLAY = "x402-data-api"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "revenue_usd")


def main():
    verified_path = os.path.join(DATA_BASE, f"{PLAY}-revenue", "ledger_verified_summary.json")
    probe_path    = os.path.join(DATA_BASE, f"{PLAY}-revenue", "probe_check_summary.json")

    # ── Read verified summary ──────────────────────────────────────
    if not os.path.isfile(verified_path):
        print(f"ERROR: ledger_verified_summary not found at {verified_path}", file=sys.stderr)
        sys.exit(1)

    with open(verified_path) as f:
        verified = json.load(f)

    # ── Read probe-check summary ───────────────────────────────────
    if not os.path.isfile(probe_path):
        print(f"ERROR: probe_check_summary not found at {probe_path}", file=sys.stderr)
        sys.exit(1)

    with open(probe_path) as f:
        probe = json.load(f)

    # ── Build probe-flagged addresses set ──────────────────────────
    probe_addrs = set()
    for r in probe.get("results", []):
        if r.get("probe_likely") and r.get("address"):
            probe_addrs.add(r["address"].lower())

    # ── Compute organic total ──────────────────────────────────────
    # Start with rows classified "external" (non-self-traffic),
    # subtract rows where the payer is a confirmed probe/bot.
    organic_total = 0.0
    counts = {
        "external_from_ledger": 0,
        "probe_flagged": 0,
        "organic_remaining": 0,
    }

    for row in verified.get("rows", []):
        if row.get("classification") != "external":
            continue
        counts["external_from_ledger"] += 1
        payer = (row.get("from") or "").lower()
        if payer in probe_addrs:
            counts["probe_flagged"] += 1
        else:
            organic_total += row.get("amount", 0.0)
            counts["organic_remaining"] += 1

    organic_total = round(organic_total, 6)

    # ── Write outputs ──────────────────────────────────────────────
    # Single output on purpose: `revenue_usd_corrected` belongs to
    # reconcile_live_revenue.py (two rails). Writing it here would clobber the
    # milestone reading with this script's ledger-only basis.
    with open(OUTPUT_PATH, "w") as f:
        f.write(f"{organic_total}\n")

    print(f"revenue_usd={organic_total}")
    print(f"  external rows from ledger:   {counts['external_from_ledger']}")
    print(f"  probe-flagged rows deducted: {counts['probe_flagged']}")
    print(f"  organic rows remaining:      {counts['organic_remaining']}")
    print(f"  output: {OUTPUT_PATH}")
    print("  (revenue_usd_corrected is produced by reconcile_live_revenue.py — x402 + fiat)")


if __name__ == "__main__":
    main()
