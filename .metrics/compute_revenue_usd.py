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
"""

import json
import os
import sys

DATA_BASE = os.path.expanduser("~/.hermes/data")
PLAY = "x402-data-api"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "revenue_usd")
OUTPUT_PATH_CORRECTED = os.path.join(SCRIPT_DIR, "revenue_usd_corrected")


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
    with open(OUTPUT_PATH, "w") as f:
        f.write(f"{organic_total}\n")
    with open(OUTPUT_PATH_CORRECTED, "w") as f:
        f.write(f"{organic_total}\n")

    print(f"revenue_usd={organic_total}")
    print(f"revenue_usd_corrected={organic_total}")
    print(f"  external rows from ledger:   {counts['external_from_ledger']}")
    print(f"  probe-flagged rows deducted: {counts['probe_flagged']}")
    print(f"  organic rows remaining:      {counts['organic_remaining']}")
    print(f"  output: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
