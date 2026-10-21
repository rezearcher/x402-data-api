#!/usr/bin/env python3
"""competitor_buyer_targeting.py — find the NEXT real integrator before it ever
touches us, by watching who pays our DIRECT competitors on the Base x402 rail.

Why this exists (2026-10-21):
  buyer_demand_intel.py only sees wallets that already paid *us* (currently 2, both
  catalog-sweep bots). It is structurally blind to the buyer that will become our
  first real integrator — that buyer is, right now, paying a COMPETITOR for the same
  data. The goal-gate has named "improve targeting / the repliers don't convert" for
  many cycles; cold-outreach is the forbidden lever (144 pulls, $0). The fix is not
  more cold pitches — it is a ground-truth, on-chain targeting feed: join the de-washed
  ecosystem census (buyer->seller edges) against the known competitor payTo map,
  keep only competitors whose product overlaps a lane WE serve, and rank the buyers
  by DEPTH (repeat/concentrated = real integrator) vs BREADTH (catalog-sweep = scorer
  bot). For each convertible buyer we emit the competitor route+price they pay and OUR
  cheaper equivalent route+price — a paste-ready pitch delta for the next cycle.

Ground-truth only (no hardcoded prospect roster): competitors come from the on-chain
payTo map, buyers from on-chain settlement census, lanes from URL+our live catalogue,
convertibility from the buyer's own behavioral depth. Degrades OPEN — any missing input
yields an explicit status, never a silent empty gate.

Usage: python3 -I scripts/competitor_buyer_targeting.py
Outputs: ~/.hermes/data/x402-demand/competitor_buyer_targeting.json
"""
import collections
import datetime
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PAYTO = os.path.join(HERE, "competitor_payto.json")
CENSUS = os.path.expanduser("~/.hermes/data/x402-demand/buyer_seller_log.jsonl")
OUT = os.path.expanduser("~/.hermes/data/x402-demand/competitor_buyer_targeting.json")
WELLKNOWN = "https://x402-data-api.sigrunner.workers.dev/.well-known/x402"

OUR_WALLETS = {
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10",
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e",
    "0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685",
}

# Depth/breadth classifier (same signals as buyer_demand_intel). A real integrator
# makes REPEAT calls concentrated on ONE competitor/product; a scorer/census bot
# samples MANY sellers' whole catalogues once. Data, editable; degrade-open.
SWEEP_MIN_DISTINCT_SELLERS = 6   # paid this many+ distinct competitors...
SWEEP_MAX_PER_SELLER = 2.5       # ...at <=2.5 calls each on average = catalog sweep

# Lane overlap: map a competitor URL -> the lane we serve, and that lane -> the
# keyword(s) that identify OUR cheapest equivalent route in the live catalogue.
# (keyword list is config/data, matched against live catalogue paths, NOT a decision
#  gate — if a new lane appears it degrades to "no-match" and is reported, not hidden.)
# Hard exclude: competitor products in domains we do NOT serve (so a loose keyword
# like "scam" can't false-match an email-scam or medical API into our lane).
NOT_OUR_DOMAIN = re.compile(r"email|/drug|medical|/fda|/bio|rxnorm|rxterms|veterinary|/crime|recall|mesh/|webpage")

LANE_RULES = [
    ("yields",       re.compile(r"yield|/apy|lending|lp-|liquidity-pool"), ["/defi/yields", "/defi/safe-yields", "/defi/yields-top"]),
    ("stablecoins",  re.compile(r"stable|/peg"),                           ["/crypto/stablecoins", "/defi/yields"]),
    ("token-safety", re.compile(r"token|rug|honeypot|audit|safety|risk|scam|verdict|trust|security|sanitize|holder|deployer|exit|flags|fresh|impostor"), ["/chain/token-report", "/gate/swap", "/chain/token-security"]),
    ("pool-dex",     re.compile(r"uniswap|pool|aero|dex|swap-sim"),        ["/defi/dex-volume", "/defi/protocols-top"]),
    ("screener",     re.compile(r"screener|trending|movers|token-score|alpha"), ["/crypto/trending", "/crypto/movers", "/crypto/markets-top"]),
    ("wallet",       re.compile(r"wallet|/score|address-risk"),            ["/chain/wallet"]),
]


def log(*a):
    print(*a, file=sys.stderr)


def fetch_our_catalogue():
    """path -> price_usdc (float) from the live well-known. Degrade-open to {}."""
    try:
        req = urllib.request.Request(WELLKNOWN, headers={"User-Agent": "greyridge-targeting/1.0"})
        d = json.load(urllib.request.urlopen(req, timeout=25))
    except Exception as e:
        log("well-known fetch failed:", e)
        return {}
    out = {}
    for r in (d.get("resources") or d.get("accepts") or []):
        res = r.get("resource", "")
        path = res.split("sigrunner.workers.dev", 1)[-1] if "sigrunner" in res else res
        pr = r.get("price_usdc")
        try:
            out[path] = float(pr) if pr is not None else None
        except (TypeError, ValueError):
            out[path] = None
    return out


def our_route_for(lane, catalogue):
    """Return (path, price) = cheapest priced route we serve in this lane, else (None,None)."""
    cands = {name: routes for name, _, routes in LANE_RULES}.get(lane, [])
    best = None
    for path in cands:
        price = catalogue.get(path)
        if path in catalogue and price is not None:
            if best is None or price < best[1]:
                best = (path, price)
    # fall back to first candidate even if price unknown, so we still name a route
    if best is None and cands:
        return (cands[0], catalogue.get(cands[0]))
    return best or (None, None)


def main():
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result = {"generated_at": now, "status": "ok", "alert": False}

    if not os.path.exists(PAYTO):
        result.update(status="degraded", reason="no competitor_payto.json")
        emit(result)
        return
    if not os.path.exists(CENSUS):
        result.update(status="degraded", reason="no census file")
        emit(result)
        return

    payto = json.load(open(PAYTO))
    payto_age_days = round((datetime.datetime.now().timestamp() - os.path.getmtime(PAYTO)) / 86400, 1)
    result["competitor_payto_age_days"] = payto_age_days
    if payto_age_days > 7:
        result["payto_stale_warning"] = (
            f"competitor_payto.json is {payto_age_days}d old and has no auto-refresh; "
            "new competitors won't be seen. Re-snapshot the facilitator catalogue."
        )
    catalogue = fetch_our_catalogue()
    result["our_catalogue_routes"] = len(catalogue)

    # competitor seller addr -> {lanes, urls, min_price_by_lane}
    sellers = {}
    for row in payto:
        try:
            addr, url, price = row[0].lower(), row[1], row[2]
        except Exception:
            continue
        if NOT_OUR_DOMAIN.search(url.lower()):
            continue  # off-lane domain we don't serve — never a pitch target
        price_f = (int(price) / 1e6) if price not in (None, "", "null") else None
        lanes = set()
        for lane, rx, _ in LANE_RULES:
            if rx.search(url.lower()):
                lanes.add(lane)
        if not lanes:
            continue  # competitor product doesn't overlap any lane we serve
        s = sellers.setdefault(addr, {"lanes": set(), "routes": []})
        s["lanes"] |= lanes
        s["routes"].append({"url": url, "price_usdc": price_f, "lanes": sorted(lanes)})

    result["overlapping_competitor_sellers"] = len(sellers)

    # join census: buyer -> seller counts, restricted to overlapping competitors.
    # Also track each buyer's FULL-census distinct-seller footprint: an ecosystem
    # scorer/census bot (e.g. Lumiere PayCheck) pays many unrelated sellers rail-wide,
    # which is the behavioral signal that it will never become a real integrator — no
    # hardcoded wallet roster, the breadth is measured from on-chain data.
    buys = collections.defaultdict(lambda: collections.Counter())  # buyer -> seller -> n
    ecosystem_sellers = collections.defaultdict(set)  # buyer -> all distinct sellers railwide
    total_rows = 0
    for line in open(CENSUS):
        total_rows += 1
        try:
            r = json.loads(line)
        except Exception:
            continue
        b = str(r.get("b", "")).lower()
        s = str(r.get("s", "")).lower()
        if not b or b in OUR_WALLETS:
            continue
        ecosystem_sellers[b].add(s)
        if s in sellers:
            buys[b][s] += 1
    result["census_rows"] = total_rows

    prospects = []
    for buyer, seller_counts in buys.items():
        total = sum(seller_counts.values())
        distinct_sellers = len(seller_counts)
        per_seller = total / distinct_sellers if distinct_sellers else 0
        top_seller, top_n = seller_counts.most_common(1)[0]
        # multi-seller sweep: pays many competitors ~once each (ecosystem scorer)
        multi_sweep = (distinct_sellers >= SWEEP_MIN_DISTINCT_SELLERS and per_seller <= SWEEP_MAX_PER_SELLER)
        # single-seller catalogue sweep: hammers ONE competitor's whole route menu a
        # couple times each (grading that seller, not using one product). Census has
        # no route granularity, so infer from how many routes that seller publishes.
        top_seller_routes = max(1, len(sellers[top_seller]["routes"]))
        calls_per_route = top_n / top_seller_routes
        single_sweep = (top_seller_routes >= 4 and calls_per_route <= 2.5)
        # ecosystem scorer: pays many unrelated sellers rail-wide = grading the rail,
        # not integrating one product (catches Lumiere-style probers by behavior).
        eco_sellers = len(ecosystem_sellers.get(buyer, ()))
        eco_scorer = eco_sellers >= SWEEP_MIN_DISTINCT_SELLERS
        is_sweep = multi_sweep or single_sweep or eco_scorer
        lanes = set()
        for s in seller_counts:
            lanes |= sellers[s]["lanes"]
        # build pitch deltas: for each lane this buyer spends in, our cheaper route
        pitch = []
        for lane in sorted(lanes):
            our_path, our_price = our_route_for(lane, catalogue)
            # cheapest competitor route in this lane that this buyer's sellers sell
            comp_best = None
            for s in seller_counts:
                for rt in sellers[s]["routes"]:
                    if lane in rt["lanes"] and rt["price_usdc"] is not None:
                        if comp_best is None or rt["price_usdc"] < comp_best["price_usdc"]:
                            comp_best = rt
            entry = {"lane": lane, "our_route": our_path, "our_price_usdc": our_price}
            if comp_best:
                entry["competitor_route"] = comp_best["url"]
                entry["competitor_price_usdc"] = comp_best["price_usdc"]
                if our_price and comp_best["price_usdc"]:
                    entry["we_are_cheaper_x"] = round(comp_best["price_usdc"] / our_price, 2)
            pitch.append(entry)
        # depth score: concentration on one competitor + repeat volume, minus sweep
        depth_score = 0 if is_sweep else (top_n + (2 if top_n >= 4 else 0))
        prospects.append({
            "buyer": buyer,
            "classification": "catalog-sweep-bot" if is_sweep else "candidate-integrator",
            "total_competitor_calls": total,
            "distinct_competitors": distinct_sellers,
            "calls_per_competitor": round(per_seller, 2),
            "top_competitor": top_seller,
            "top_competitor_calls": top_n,
            "top_competitor_routes": top_seller_routes,
            "calls_per_route_top": round(calls_per_route, 2),
            "ecosystem_distinct_sellers": eco_sellers,
            "sweep_reason": ("ecosystem-scorer" if eco_scorer else "multi-seller" if multi_sweep else "single-seller-catalog" if single_sweep else ""),
            "lanes": sorted(lanes),
            "depth_score": depth_score,
            "pitch_delta": pitch,
        })

    prospects.sort(key=lambda p: (p["depth_score"], p["total_competitor_calls"]), reverse=True)
    result["total_buyers_of_overlapping_competitors"] = len(prospects)
    convertibles = [p for p in prospects if p["classification"] == "candidate-integrator" and p["depth_score"] >= 4]
    result["convertible_candidates"] = len(convertibles)
    result["prospects"] = prospects[:25]

    # alert only when a GENUINE depth buyer of a direct competitor appears — a real
    # named targeting lead the next cycle can act on (not a sweep bot).
    if convertibles:
        result["alert"] = True
        top = convertibles[0]
        result["summary"] = (
            f"TARGET: {top['buyer']} pays competitor {top['top_competitor']} "
            f"{top['top_competitor_calls']}x in lane {top['lanes']} — convertible depth buyer; "
            f"pitch our cheaper route(s)."
        )
    else:
        result["summary"] = (
            f"{len(prospects)} buyers of {len(sellers)} overlapping competitors in census; "
            f"0 convertible depth buyers (all sweep/thin). No pitch target this cycle."
        )
    emit(result)


def emit(result):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps({k: v for k, v in result.items() if k != "prospects"}, indent=2))
    print(f"\n[wrote {OUT}]")


if __name__ == "__main__":
    main()
