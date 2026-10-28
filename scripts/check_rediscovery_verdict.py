#!/usr/bin/env python3
"""Re-listing verdict harness for x402-data-api (card t_cac01ee4).

The card's literal ACCEPTANCE string --
  curl -s 'https://UNKNOWN/discovery/resources?q=x402-data-api' | grep -q 'x402-data-api'
-- can never pass: the host is the literal placeholder UNKNOWN, and
/discovery/resources ignores q/query (verified: the unfiltered catalog total is
returned with or without the parameter). This harness replaces it with three
measurements that actually move the needle, and refuses to report success until
the index-side signal (lastCalledAt advancing past the settlement) is real.

Exit 0 only if re-listing is proven. Exit 1 otherwise, printing which of the
gate conditions failed, so a re-run after a Worker deploy + fresh settlement
gives a clean yes/no.

Usage: python3 scripts/check_rediscovery_verdict.py [--since 2026-10-28T06:02:47Z]
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-28T06:02:47Z",
                    help="settlement timestamp; lastCalledAt must move past this for the index to have landed")
    ap.add_argument("--queries", nargs="*", default=["is this token a scam", "token security", "honeypot detector"])
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

    checks = []
    checks.append(("record.lastUpdated >= settlement", bool(upd_dt and since_dt and upd_dt >= since_dt), last_updated))
    checks.append(("index signal: lastCalledAt advanced past settlement",
                   bool(called_dt and since_dt and called_dt > since_dt), last_called))
    checks.append(("description mentions 'scam' (buyer-intent vocabulary)",
                   "scam" in (rec.get("description") or "").lower(),
                   f"{len(rec.get('description') or '')} chars"))

    per_query = {}
    for query in args.queries:
        d = get(f"{API}/search?query={urllib.parse.quote(query)}&limit=20")
        items = d.get("resources", d.get("items", []))
        ranks = [i + 1 for i, r in enumerate(items) if "sigrunner" in (r.get("resource") or "")]
        per_query[query] = {"results": len(items), "our_ranks": ranks}
    checks.append(("surfaced by at least one buyer-intent query",
                   any(v["our_ranks"] for v in per_query.values()),
                   json.dumps(per_query)))

    print(f"settled route : {SETTLED_ROUTE}")
    print(f"lastUpdated   : {last_updated}")
    print(f"lastCalledAt  : {last_called}  (calls30d={q.get('l30DaysTotalCalls')}, payers30d={q.get('l30DaysUniquePayers')})")
    for name, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")

    if all(ok for _, ok, _ in checks):
        print("\nVERDICT: RE-LISTED (record refreshed, index advanced, buyer-intent query surfaces us)")
        return 0
    print("\nVERDICT: NOT RE-LISTED -- the catalog accepted the write but the index/search benefit did not land.")
    print("Next action: Worker must serve the rewritten description BEFORE a fresh settlement (src/index.ts),")
    print("then re-run: node scripts/settle_once.js --route /chain/token-security && python3 scripts/check_rediscovery_verdict.py")
    return 1


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (used inside main via urllib.parse.quote)
    sys.exit(main())
