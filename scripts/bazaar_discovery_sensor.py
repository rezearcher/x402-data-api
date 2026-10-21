#!/usr/bin/env python3
"""
bazaar_discovery_sensor.py — Does an agent-buyer searching the CDP x402 Bazaar
for our categories actually FIND us, and at what rank?

WHY: Being indexed is not the same as being discoverable. CDP discovery is a
semantic (embedding) search over each resource's registered description /
serviceName / tags. If our flagship routes don't rank in the top results for the
natural buyer queries ("token safety", "is this token a scam", "rug pull check"),
an agent-buyer never finds us even though we are in the catalog. This sensor
measures that gap every run so a future cycle can see whether discoverability
work (desc/tags tuning, re-index) is actually moving rank.

MEASURE: for each canonical buyer query, query the live CDP discovery/search
endpoint (limit 20) and record the best (lowest) rank at which any Grey Ridge
route appears, plus which route. 0 self-pay, read-only.

OUTPUT: ~/.hermes/data/x402_bazaar_index/discovery_rank.json
  { generated_at, queries:[{q, n_results, our_best_rank|null, our_route|null, our_count}],
    found_for, total_queries, coverage_pct, alert }
alert=True when coverage < 50% (most buyer queries don't surface us in top-20).

Exit code: 0 always (sensor; never blocks a cron).
Usage: python3 -I scripts/bazaar_discovery_sensor.py [extra query ...]
"""
import json, os, sys, time, urllib.parse, urllib.request, datetime

# Canonical queries an agent-buyer would actually type for our product surface.
QUERIES = [
    "token safety check before swap",
    "is this token a scam",
    "rug pull check base token",
    "honeypot detector base erc20",
    "token risk report",
    "pre-trade safety gate",
    "gas price base",
    "crypto funding rates",
    "defi yields",
    "prediction market odds",
]
QUERIES += sys.argv[1:]

OUT_DIR = os.path.join(os.path.expanduser("~"), ".hermes", "data", "x402_bazaar_index")
OUT = os.path.join(OUT_DIR, "discovery_rank.json")
BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search"
OURS = ("sigrunner", "greyridge")


def _is_ours(r):
    blob = (str(r.get("resource") or "") + " " + str(r.get("url") or "") + " " +
            str(r.get("description") or "") + " " + json.dumps(r.get("accepts") or [])).lower()
    # our receiving wallet is the unambiguous fingerprint
    if "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10" in blob:
        return True
    return any(o in blob for o in OURS)


def _route_of(r):
    res = r.get("resource")
    if isinstance(res, str):
        return res[-45:]
    return (r.get("url") or r.get("description") or "")[:45]


def probe(q):
    u = BASE + "?" + urllib.parse.urlencode({"query": q, "limit": 20})
    req = urllib.request.Request(u, headers={"user-agent": "Mozilla/5.0 (greyridge-discovery-sensor)"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=25))
    except Exception as e:
        return {"q": q, "error": f"{type(e).__name__}: {e}", "n_results": 0,
                "our_best_rank": None, "our_route": None, "our_count": 0}
    rs = d.get("resources") or d.get("items") or []
    ranks = [(i + 1, _route_of(r)) for i, r in enumerate(rs) if _is_ours(r)]
    best = ranks[0] if ranks else (None, None)
    return {"q": q, "n_results": len(rs), "our_best_rank": best[0],
            "our_route": best[1], "our_count": len(ranks)}


def main():
    results = []
    for q in QUERIES:
        results.append(probe(q))
        time.sleep(0.4)
    found = sum(1 for r in results if r.get("our_best_rank"))
    total = len(results)
    cov = round(100.0 * found / total, 1) if total else 0.0
    payload = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "endpoint": BASE,
        "total_queries": total,
        "found_for": found,
        "coverage_pct": cov,
        "alert": cov < 50.0,
        "queries": results,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"bazaar discovery coverage: {found}/{total} queries surface us ({cov}%)"
          + ("  [ALERT: most buyer queries don't find us]" if payload["alert"] else ""))
    for r in results:
        rk = r.get("our_best_rank")
        tag = f"rank {rk} {r.get('our_route')}" if rk else ("ERR " + r["error"] if r.get("error") else "NOT in top-20")
        print(f"  {r['q']!r:40s} n={r['n_results']:2d}  {tag}")
    print(f"written -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
