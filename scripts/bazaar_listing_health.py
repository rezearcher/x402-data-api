#!/usr/bin/env python3
"""
bazaar_listing_health.py — Is our route catalog actually INDEXED in the CDP x402
Bazaar right now, or has it silently decayed out?

WHY (distinct from bazaar_discovery_sensor.py): the discovery sensor measures
RANK for buyer queries — the SYMPTOM. This sensor measures INDEX COVERAGE — the
CAUSE. CDP Bazaar freshness only persists while a route keeps settling THROUGH
the CDP facilitator; production settles via xpay (FACILITATOR_MODE != "cdp"), so
real payments are invisible to the Bazaar and routes age out of the discovery
index. The band-aid refresher (scripts/refresh_bazaar_catalog.js) must be cron'd
to keep them fresh. When it stops, routes fall out of the catalog ONE BY ONE and
nothing notices — on 2026-11-05 we had decayed from the 23 manifest routes down
to 7 indexed, silently dropping high-demand /crypto/funding, /pm/markets and
/chain/token-report (exactly the queries the rank sensor then shows us missing
for). This sensor makes that decay a first-class, connected signal: it quantifies
coverage, names which DEMANDED routes fell out, and will confirm the heal when
FACILITATOR_MODE=cdp (CDP creds) lands.

MEASURE (read-only, 0 self-pay, 0 cost):
  - expected = routes in the refresher manifest (parsed at runtime — the single
    source of truth for "routes we register"; no hardcoded roster per the
    no-hardcoded-list rule).
  - indexed  = of those, how many currently appear in the live CDP
    discovery/resources catalog (paginated scan, our two hostnames).
  - demand   = external payers per route from src/demand_snapshot.ts, so a
    de-indexed route that HAS real demand is flagged higher than a cold one.

OUTPUT: ~/.hermes/data/x402_bazaar_index/listing_health.json
  { generated_at, expected_total, indexed_total, coverage_pct,
    indexed[], missing[], missing_with_demand[{route,payers}],
    root_cause, remediation, alert }
alert=True when coverage < 70% OR any route with >=2 external payers is missing.

Exit code: 0 always (sensor; never blocks a cron).
Usage: python3 -I scripts/bazaar_listing_health.py
"""
import datetime
import json
import os
import re
import sys
import urllib.request

PROJ = os.path.join(os.environ.get("HOME", ""), "projects", "x402-data-api")
MANIFEST = os.path.join(PROJ, "scripts", "refresh_bazaar_catalog.js")
DEMAND = os.path.join(PROJ, "src", "demand_snapshot.ts")
OUT_DIR = os.path.join(os.environ.get("HOME", ""), ".hermes", "data", "x402_bazaar_index")
OUT = os.path.join(OUT_DIR, "listing_health.json")
DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources"
OUR_HOSTS = ("sigrunner.workers.dev", "greyridgesignals.ai")


def expected_routes():
    """Parse the refresher manifest — the source of truth for registered routes."""
    try:
        src = open(MANIFEST).read()
    except OSError:
        return []
    return sorted(set(re.findall(r"route:\s*'(/[^']+)'", src)))


def demand_by_route():
    """Parse external_by_route from the auto-generated demand snapshot."""
    out = {}
    try:
        src = open(DEMAND).read()
    except OSError:
        return out
    block = re.search(r"external_by_route:\s*\{(.*?)\}", src, re.S)
    if not block:
        return out
    for m in re.finditer(r'"(/[^"]+)":\s*(\d+)', block.group(1)):
        out[m.group(1)] = int(m.group(2))
    return out


def indexed_route_paths():
    """Scan the live CDP discovery catalog; return the set of OUR route paths
    (path component only, host-agnostic) currently indexed."""
    found = set()
    scanned = 0
    for off in range(0, 4000, 100):
        url = f"{DISCOVERY}?limit=100&offset={off}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "grey-ridge-listing-health"})
            d = json.load(urllib.request.urlopen(req, timeout=30))
        except Exception:
            break
        items = d.get("items") or d.get("resources") or []
        scanned += len(items)
        for r in items:
            res = r.get("resource") or r.get("url") or ""
            if any(h in res for h in OUR_HOSTS):
                # reduce full URL to its path (strip scheme+host, drop query)
                m = re.search(r"https?://[^/]+(/[^?#]*)", res)
                if m:
                    found.add(m.group(1).rstrip("/") or "/")
        if len(items) < 100:
            break
    return found, scanned


def main():
    exp = expected_routes()
    demand = demand_by_route()
    idx_paths, scanned = indexed_route_paths()

    indexed = [r for r in exp if r in idx_paths]
    missing = [r for r in exp if r not in idx_paths]
    missing_with_demand = sorted(
        ({"route": r, "payers": demand.get(r, 0)} for r in missing if demand.get(r, 0) >= 1),
        key=lambda x: -x["payers"],
    )
    cov = round(100.0 * len(indexed) / len(exp), 1) if exp else 0.0

    # alert on a FIXABLE decay: low coverage, or any demanded route de-indexed.
    high_demand_missing = [m for m in missing_with_demand if m["payers"] >= 2]
    alert = bool(exp) and (cov < 70.0 or high_demand_missing)

    payload = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "catalog_scanned": scanned,
        "expected_total": len(exp),
        "indexed_total": len(indexed),
        "coverage_pct": cov,
        "indexed": indexed,
        "missing": missing,
        "missing_with_demand": missing_with_demand,
        "root_cause": (
            "CDP Bazaar index freshness decays unless routes keep settling THROUGH "
            "the CDP facilitator; production settles via xpay (invisible to Bazaar). "
            "Routes age out until the refresher re-settles them."
        ) if missing else "",
        "remediation": (
            "Clean fix: set FACILITATOR_MODE=cdp + CDP_API_KEY_ID/SECRET so real "
            "external payments refresh the listing honestly (already-open CDP-creds "
            "atom). Interim: cron scripts/refresh_bazaar_catalog.js (needs "
            "RAPIDAPI_PROXY_SECRET; self-settlement, revenue-excluded)."
        ) if missing else "",
        "alert": alert,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"bazaar listing coverage: {len(indexed)}/{len(exp)} manifest routes indexed ({cov}%)"
          + ("  [ALERT]" if alert else ""))
    if missing_with_demand:
        print("  de-indexed routes WITH external demand (restore first):")
        for m in missing_with_demand:
            print(f"    {m['route']:24s} payers={m['payers']}")
    cold_missing = [r for r in missing if demand.get(r, 0) == 0]
    if cold_missing:
        print(f"  de-indexed cold routes ({len(cold_missing)}): " + ", ".join(cold_missing))
    if alert:
        print("  root cause: xpay settlement is invisible to CDP Bazaar -> routes age out.")
        print("  remediation: FACILITATOR_MODE=cdp (clean) or cron refresh_bazaar_catalog.js (interim).")
    print(f"written -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
