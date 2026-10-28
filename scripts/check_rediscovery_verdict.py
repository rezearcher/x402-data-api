#!/usr/bin/env python3
"""Re-listing verdict harness for x402-data-api (cards t_cac01ee4, t_d5138bac).

The card's literal ACCEPTANCE string --
  curl -s 'https://UNKNOWN/discovery/resources?q=x402-data-api' | grep -q 'x402-data-api'
-- can never pass: the host is the literal placeholder UNKNOWN, and
/discovery/resources ignores q/query (verified: the unfiltered catalog total is
returned with or without the parameter). This harness replaces it with four
measurements that actually move the needle.

Why there are FOUR legs and not one gate
----------------------------------------
The settled call drives two legs on two different clocks:

  synchronous  lastUpdated + the stored description (re-crawled from the live 402
               at settlement second). Lands in <1s.
  asynchronous lastCalledAt / l30DaysTotalCalls / l30DaysUniquePayers. Lands on
               CDP's own schedule -- measured on this route at ~75 minutes, vs
               ~4 seconds for api.greyridgesignals.ai/chain/token-report. See
               docs/division-memory/cdp-relisting-method.md section 3.

A verdict taken inside that lag window is a false negative, and the old FAIL
remediation ("re-run settle_once.js") spent real money to "unstick" a leg that
was merely slow. Two independent T+30-style passes on 2026-10-28 both called the
index dead while it was still in flight.

So the gate is the business outcome (description published + a buyer-intent query
surfaces us), and the quality counters are a lagging indicator reported, not
gated, until --pending-window-minutes has elapsed.

Exit codes
  0  RE-LISTED    business outcome landed AND the index counter advanced
  2  PENDING      business outcome landed, index counter still inside the
                  documented async window. DO NOT SETTLE AGAIN. Re-run later.
  1  INDEX-BROKEN business outcome landed but the window expired with the
                  counter frozen -> escalate a card against the index pipeline.
  1  NOT RE-LISTED the business outcome itself did not land (deploy/Worker issue).

Never settles anything. Never mutates the Worker. Reads only.

Usage:
  python3 scripts/check_rediscovery_verdict.py --since 2026-10-28T07:14:09.618Z
  python3 scripts/check_rediscovery_verdict.py --since ... --write-verdict logs/verdict.json
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://api.cdp.coinbase.com/platform/v2/x402/discovery"
PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10"
SETTLED_ROUTE = "/chain/token-security"

# Documented upper bound of the async quality-counter leg on THIS route.
# Measured: seq 1 (06:02Z settlement) landed ~75 min later; the +55 min pass had
# wrongly declared it dead. Anything under this is pending, not failed.
DEFAULT_PENDING_WINDOW_MINUTES = 90


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def ts(value):
    """Parse an ISO-8601 instant. Never compare these as strings: '...47.625Z'
    sorts BEFORE '...47Z' lexicographically, which silently inverts a
    'did lastUpdated advance?' check."""
    if not value:
        return None
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    # normalise fractional seconds to at most 6 digits, keeping any offset intact
    if "." in v:
        head, _, tail = v.partition(".")
        n = 0
        while n < len(tail) and tail[n].isdigit():
            n += 1
        frac, rest = tail[:n], tail[n:]
        v = f"{head}.{frac[:6].ljust(6, '0')}{rest or '+00:00'}"
    dt = datetime.fromisoformat(v)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def find_merchant_record():
    for offset in range(0, 200, 20):
        d = get(f"{API}/merchant?payTo={PAY_TO}&limit=20&offset={offset}")
        for rec in d.get("resources", d.get("items", [])):
            if (rec.get("resource") or "").endswith(SETTLED_ROUTE):
                return rec
    return None


def decide(record_ok, index_ok, desc_ok, search_ok, elapsed_min, window_min):
    """Pure decision function so the state machine is testable without network."""
    business_ok = desc_ok and search_ok
    if record_ok and index_ok and business_ok:
        return "RE-LISTED", 0
    if record_ok and business_ok:
        if elapsed_min < window_min:
            return "PENDING", 2
        return "INDEX-BROKEN", 1
    return "NOT RE-LISTED", 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-28T06:02:47Z",
                    help="settlement timestamp; lastCalledAt must move past this for the index to have landed")
    ap.add_argument("--queries", nargs="*", default=["is this token a scam", "token security", "honeypot detector"])
    ap.add_argument("--pending-window-minutes", type=float, default=DEFAULT_PENDING_WINDOW_MINUTES,
                    help="how long the async quality-counter leg may legally lag before it is index-broken")
    ap.add_argument("--write-verdict", default="",
                    help="append one JSON run record to this path (committed evidence)")
    args = ap.parse_args()

    rec = find_merchant_record()
    if not rec:
        print("FAIL  settled route not present in the merchant feed at all")
        return 1
    q = rec.get("quality") or {}
    last_called = q.get("lastCalledAt") or ""
    last_updated = rec.get("lastUpdated") or ""
    since_dt = ts(args.since)
    upd_dt, called_dt = ts(last_updated), ts(last_called)
    now = datetime.now(timezone.utc)
    elapsed_min = (now - since_dt).total_seconds() / 60.0 if since_dt else float("inf")

    record_ok = bool(upd_dt and since_dt and upd_dt >= since_dt)
    index_ok = bool(called_dt and since_dt and called_dt > since_dt)
    desc_ok = "scam" in (rec.get("description") or "").lower()

    per_query = {}
    for query in args.queries:
        d = get(f"{API}/search?query={urllib.parse.quote(query)}&limit=20")
        items = d.get("resources", d.get("items", []))
        ranks = [i + 1 for i, r in enumerate(items) if "sigrunner" in (r.get("resource") or "")]
        per_query[query] = {"results": len(items), "our_ranks": ranks}
    search_ok = any(v["our_ranks"] for v in per_query.values())

    verdict, code = decide(record_ok, index_ok, desc_ok, search_ok,
                           elapsed_min, args.pending_window_minutes)
    deadline = (since_dt.timestamp() + args.pending_window_minutes * 60) if since_dt else None
    deadline_iso = (datetime.fromtimestamp(deadline, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    if deadline else "n/a")

    print(f"settled route : {SETTLED_ROUTE}")
    print(f"settlement    : {args.since}   (T+{elapsed_min:.0f} min, window {args.pending_window_minutes:.0f} min)")
    print(f"lastUpdated   : {last_updated}")
    print(f"lastCalledAt  : {last_called}  (calls30d={q.get('l30DaysTotalCalls')}, payers30d={q.get('l30DaysUniquePayers')})")
    for name, ok, detail in [
        ("record.lastUpdated >= settlement", record_ok, last_updated),
        ("BUSINESS: description mentions 'scam' (buyer-intent vocabulary)", desc_ok,
         f"{len(rec.get('description') or '')} chars"),
        ("BUSINESS: surfaced by at least one buyer-intent query", search_ok, json.dumps(per_query)),
        ("LAGGING: lastCalledAt advanced past settlement", index_ok, last_called),
    ]:
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")

    if verdict == "RE-LISTED":
        print("\nVERDICT: RE-LISTED (record refreshed, business outcome landed, index counter advanced)")
    elif verdict == "PENDING":
        print(f"\nVERDICT: PENDING -- business outcome landed; the async quality counter is still inside its"
              f" documented window (T+{elapsed_min:.0f} of {args.pending_window_minutes:.0f} min, deadline {deadline_iso}).")
        print("Next action: NONE that costs money. Do NOT settle again to unstick this -- the counter is slow,")
        print(f"not stuck, and a second settlement buys nothing. Re-run at/after {deadline_iso}.")
    elif verdict == "INDEX-BROKEN":
        print(f"\nVERDICT: INDEX-BROKEN -- business outcome landed, but the async counter is still frozen at"
              f" T+{elapsed_min:.0f} min, past the {args.pending_window_minutes:.0f} min window ({deadline_iso}).")
        print("Next action: escalate a card against the index/discovery pipeline with this run as evidence.")
        print("Do NOT settle again: a settlement cannot repair a counter that is not being written.")
    else:
        print("\nVERDICT: NOT RE-LISTED -- the catalog record or the buyer-facing outcome did not land.")
        print("Next action: fix the served 402 description (src/index.ts) and confirm it live BEFORE spending:")
        print("  curl -s https://x402-data-api.sigrunner.workers.dev/chain/token-security | grep -qi scam")
        print("Only then, if the one-settlement-per-deploy budget allows, settle once. Never settle to probe.")

    if args.write_verdict:
        run = {
            "recorded_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "settlement_since": args.since,
            "elapsed_minutes": round(elapsed_min, 1),
            "pending_window_minutes": args.pending_window_minutes,
            "pending_deadline": deadline_iso,
            "verdict": verdict,
            "exit_code": code,
            "legs": {
                "record_lastUpdated": last_updated,
                "record_ok": record_ok,
                "description_ok": desc_ok,
                "search_ok": search_ok,
                "index_lastCalledAt": last_called,
                "index_ok": index_ok,
                "calls30d": q.get("l30DaysTotalCalls"),
                "payers30d": q.get("l30DaysUniquePayers"),
            },
            "search": per_query,
            "settlements_attempted": 0,
        }
        with open(args.write_verdict, "a") as fh:
            fh.write(json.dumps(run, sort_keys=True) + "\n")
        print(f"\nrun recorded -> {args.write_verdict}")
    return code


if __name__ == "__main__":
    sys.exit(main())
