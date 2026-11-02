#!/usr/bin/env python3
"""Free CDP Bazaar index watch: POST /platform/v2/x402/validate for every paid route
on the workers.dev host (brand host is 403'd to CDP's validator, so never indexable).
Flags routes with index=null (never settled via CDP) or lastCrawledAt older than --stale-days
(CDP delists after 30d with no settlement). Read-only, keyless. Writes data/cdp_index_watch.json.
Usage: python3 scripts/cdp_index_watch.py [--stale-days 20]"""
import argparse, json, time, urllib.request
from datetime import datetime, timezone
HOST = "https://x402-data-api.sigrunner.workers.dev"
VAL = "https://api.cdp.coinbase.com/platform/v2/x402/validate"
def req(url, body=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
        headers={"content-type": "application/json", "accept": "application/json", "user-agent": "grsg-cdp-index-watch/1"})
    with urllib.request.urlopen(r, timeout=40) as x:
        return json.load(x)
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--stale-days", type=float, default=20)
    ap.add_argument("--out", default="data/cdp_index_watch.json"); a = ap.parse_args()
    now = datetime.now(timezone.utc); rows = []
    for e in req(HOST + "/.well-known/x402").get("resources", []):
        url = e["resource"]; m = e.get("method", "GET")
        try:
            v = req(VAL, {"resource": url, "method": m})
            idx = v.get("index") or {}
            last = idx.get("lastCrawledAt")
            age = (now - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds() / 86400 if last else None
            status = "unindexed" if not idx else ("stale" if age is not None and age > a.stale_days else "ok")
            rows.append({"resource": url, "valid": v.get("valid"), "active": idx.get("active"), "last_crawled": last,
                         "age_days": round(age, 1) if age is not None else None, "status": status})
        except Exception as ex:
            rows.append({"resource": url, "status": "error", "error": str(ex)[:120]})
        time.sleep(0.4)
    summ = {s: sum(r["status"] == s for r in rows) for s in ("ok", "stale", "unindexed", "error")}
    json.dump({"checked_at": now.isoformat(), "summary": summ, "routes": rows}, open(a.out, "w"), indent=1)
    print(summ)
    for r in rows:
        if r["status"] in ("stale", "unindexed"): print(r["status"], r["resource"].replace(HOST, ""), r.get("age_days"))
main()
