#!/usr/bin/env python3
"""Referral-pilot reconcile: prove per-partner, on-chain, how many SETTLED paid
calls a ?ref=<tag> drove, split into external (real buyers) vs self (our tests).

A referral partner (e.g. an MCP-client reseller) wires ?ref=<their-tag> into the
call URL; the tag rides through the x402 402->sign->retry and is stored on the
settled PAID row (see src/index.ts getRefStats + the ref column). This script
reads the secret-gated reconcile view from the worker (which runs on Cloudflare
egress, so it is not datacenter-403'd like direct explorer calls from this host)
and renders a traced-sale summary a partner can act on.

Usage:
  TRAFFIC_STATS_SECRET=... python3 -I scripts/ref_pilot_reconcile.py [--window-hours 720] [--ref dopaminedesk]

Exit 0 always (reporting tool). Degrades loud if the secret is absent: prints the
one-time setup step instead of failing silently.
"""
import json
import os
import sys
import urllib.request
import urllib.error

BASE = os.environ.get("X402_BASE", "https://api.greyridgesignals.ai")


def main() -> int:
    args = sys.argv[1:]
    window = 720
    only_ref = None
    if "--window-hours" in args:
        window = int(args[args.index("--window-hours") + 1])
    if "--ref" in args:
        only_ref = args[args.index("--ref") + 1].lower()

    secret = os.environ.get("TRAFFIC_STATS_SECRET", "").strip()
    if not secret:
        print("NO TRAFFIC_STATS_SECRET in env — the reconcile view is secret-gated.")
        print("One-time setup: export TRAFFIC_STATS_SECRET=<value from the worker's wrangler secrets>")
        print("Then: TRAFFIC_STATS_SECRET=... python3 -I scripts/ref_pilot_reconcile.py")
        return 0

    url = f"{BASE}/internal/traffic-stats?window_hours={window}&ref_stats=1&secret={secret}"
    try:
        with urllib.request.urlopen(url, timeout=25) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:300]}")
        return 0
    except Exception as e:
        print(f"request failed: {e}")
        return 0

    refs = data.get("refs", [])
    if only_ref:
        refs = [x for x in refs if x.get("ref") == only_ref]

    print(f"=== Referral reconcile — window {window}h — {len(refs)} tag(s) ===")
    if not refs:
        print("No ?ref=-tagged settled paid calls yet. (Partners must wire ?ref=<tag> into the call URL.)")
        return 0

    tot_ext_calls = 0
    tot_ext_payers = 0
    for x in refs:
        tot_ext_calls += x.get("external_calls", 0)
        tot_ext_payers += x.get("distinct_external_payers", 0)
        print(
            f"  ref={x['ref']!r:24} paid_calls={x['paid_calls']:>5} "
            f"ext_calls={x.get('external_calls',0):>5} "
            f"ext_payers={x.get('distinct_external_payers',0):>3} "
            f"self_payers={x.get('distinct_payers',0)-x.get('distinct_external_payers',0):>3}"
        )
        for tx in x.get("txs", [])[:5]:
            print(f"        tx https://basescan.org/tx/{tx}")
    print(f"--- TRACED EXTERNAL: {tot_ext_calls} settled call(s) from {tot_ext_payers} distinct external buyer(s) ---")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
