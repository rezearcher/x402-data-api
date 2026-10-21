#!/usr/bin/env python3
"""buyer_demand_intel.py — ground-truth demand targeting from REAL x402 buyers.

Every cycle has been flailing on cold pitches (144 pulls, $0) because it had no
list of real funded buyers. This sensor builds that list from two ground-truth
sources and tells the next cycle which lane actually has paying demand:

  1. Our TrafficLog paid feed  (/internal/traffic-stats?paid=1) — the wallets that
     presented a verified x402 payment to US, and on which routes.
  2. The de-washed ecosystem census (buyer_seller_log.jsonl) — every buyer->seller
     pair on the Base x402 rail, used to size each of our buyers' total budget
     footprint (how many distinct sellers / purchases they make ecosystem-wide)
     and surface the competitor sellers they also pay in our category.

Output: ranked JSON + human summary. A buyer that paid us AND is highly active
ecosystem-wide is the single most valuable prospect we have — it already crossed
the funded-wallet + x402-client friction and chose us once.

Usage: python3 -I scripts/buyer_demand_intel.py [window_hours]   (default 336 = 14d)
Requires: 1Password `op` (Division vault) for the TrafficLog secret.
"""
import collections
import datetime
import json
import os
import subprocess
import sys
import urllib.request

B = "https://x402-data-api.sigrunner.workers.dev"
CENSUS = "/home/rez/.hermes/data/x402-demand/buyer_seller_log.jsonl"
OUT = "/home/rez/.hermes/data/x402-demand/buyer_intel_latest.json"
OUR_WALLETS = {  # never count self-dealing
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10",  # receiving
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e",  # buyer/test
    "0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685",  # buyer/test
}
WINDOW = int(sys.argv[1]) if len(sys.argv) > 1 else 336


def lane_of(path: str) -> str:
    p = path.lower()
    if p.startswith("/chain/"):
        return "onchain-data"
    if p.startswith("/gate/") or "token-report" in p or "token-security" in p:
        return "token-safety"
    if p.startswith("/ai/") or p.startswith("/v1/"):
        return "ai-inference"
    if p.startswith("/defi/"):
        return "defi"
    if p.startswith("/crypto/"):
        return "market-data"
    return "other"


def get_secret() -> str:
    try:
        return subprocess.check_output(
            ["op", "item", "get", "byllgy4p3b27hrscwcdxofe6e4",
             "--vault", "Division", "--fields", "credential", "--reveal"],
            text=True, timeout=30).strip()
    except Exception as e:
        print(f"WARN: could not read TrafficLog secret: {e}", file=sys.stderr)
        return ""


def fetch_paid(sec: str):
    url = f"{B}/internal/traffic-stats?window_hours={WINDOW}&secret={sec}&paid=1"
    req = urllib.request.Request(url, headers={"User-Agent": "greyridge-intel/1"})
    d = json.load(urllib.request.urlopen(req, timeout=40))
    if not d.get("ok"):
        return []
    return d.get("paid", [])


def load_census():
    """Return (rows, buyer_activity, buyer_sellers) from the ecosystem census."""
    rows = []
    if not os.path.exists(CENSUS):
        return rows, {}, {}
    for line in open(CENSUS):
        try:
            r = json.loads(line)
        except Exception:
            continue
        r["b"] = str(r.get("b", "")).lower()
        r["s"] = str(r.get("s", "")).lower()
        rows.append(r)
    activity = collections.Counter(r["b"] for r in rows)
    sellers = collections.defaultdict(set)
    for r in rows:
        if r["b"]:
            sellers[r["b"]].add(r["s"])
    return rows, activity, sellers


def main():
    sec = get_secret()
    paid = fetch_paid(sec) if sec else []
    rows, activity, buyer_sellers = load_census()

    # our real buyers (exclude self)
    by_buyer = collections.defaultdict(lambda: {"routes": [], "lanes": collections.Counter()})
    lane_totals = collections.Counter()
    for r in paid:
        payer = str(r.get("payer", "")).lower()
        path = r.get("path", "")
        cnt = int(r.get("count", 1))
        if payer in OUR_WALLETS or not payer:
            continue
        lane = lane_of(path)
        by_buyer[payer]["routes"].append({"path": path, "count": cnt})
        by_buyer[payer]["lanes"][lane] += cnt
        lane_totals[lane] += cnt

    prospects = []
    for payer, info in by_buyer.items():
        eco = activity.get(payer, 0)
        n_sellers = len(buyer_sellers.get(payer, set()))
        top_lane = info["lanes"].most_common(1)[0][0] if info["lanes"] else "?"
        prospects.append({
            "payer": payer,
            "paid_routes": sorted({x["path"] for x in info["routes"]}),
            "paid_calls": sum(x["count"] for x in info["routes"]),
            "top_lane": top_lane,
            "ecosystem_purchases": eco,        # budget proxy (how active in the whole rail)
            "ecosystem_distinct_sellers": n_sellers,
            "score": sum(x["count"] for x in info["routes"]) + eco,  # paid-us + overall activity
        })
    prospects.sort(key=lambda x: -x["score"])

    out = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "window_hours": WINDOW,
        "our_distinct_buyers": len(prospects),
        "demand_by_lane": dict(lane_totals.most_common()),
        "top_demand_lane": (lane_totals.most_common(1)[0][0] if lane_totals else None),
        "census_rows": len(rows),
        "prospects": prospects,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=2)

    # human summary
    print(f"=== buyer-demand intel (window {WINDOW}h) ===")
    print(f"census rows: {len(rows)} | our distinct real buyers: {len(prospects)}")
    print(f"demand by lane (our paid calls): {dict(lane_totals.most_common())}")
    print(f"TOP DEMAND LANE: {out['top_demand_lane']}")
    print("\n=== our real buyers (ranked; exclude self) ===")
    for p in prospects:
        print(f"  {p['payer']}  score={p['score']}  "
              f"paid_us={p['paid_calls']} in {p['top_lane']}  "
              f"eco_purchases={p['ecosystem_purchases']} across {p['ecosystem_distinct_sellers']} sellers")
        print(f"      routes: {', '.join(p['paid_routes'])}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
