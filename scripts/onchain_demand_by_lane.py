#!/usr/bin/env python3
"""onchain_demand_by_lane.py — measure LIVE external paying demand per lane by
reading, from the chain, who pays our COMPETITORS right now.

WHY THIS EXISTS (2026-10-21):
  Every cycle the goal-gate names "improve targeting / the repliers don't convert",
  and every cycle the targeting sensors report "0 convertible buyers". The reason is
  a measured blindness, not an absent market:

    * buyer_demand_intel sees only wallets that paid US (2, both sweep bots).
    * competitor_buyer_targeting reads the census (buyer_seller_log.jsonl), but that
      census is built from a global ~20-min AuthorizationUsed *sample* — it does NOT
      cover a specific competitor's payTo over a long window, so deep in-lane buyers
      never enter it.
    * A one-off /tmp scratch scan (competitor_payers.py) DID surface a real one —
      buyer 0xf86e616a making 33 token-safety calls (~$4.95) in a single day to
      onchainexpat ($0.15/call) — but it read /tmp, 403'd on most public RPCs, and
      never persisted anything.

  Public Base RPCs (and Blockscout) 403/429 datacenter IPs, so a pure-Python chain
  scan is unreliable. Our OWN Worker runs on a Cloudflare IP that Blockscout serves,
  and /internal/find-settlement now accepts a validated `to=<addr>` — so we proxy the
  competitor-payTo scan THROUGH the worker. Reliable, keyless-to-us, secret-gated.

WHAT IT ANSWERS (the thing that actually steers the loop):
  For each lane WE serve, is there live external paying demand on a COMPETITOR right
  now? How much ($/day), how many distinct buyers, and what is OUR cheaper equivalent
  route + the price-advantage multiple? This is evidence to decide which lanes to keep
  surfaced vs demote — e.g. it proves token-safety is NOT dead (it had a $4.95/day
  buyer), which a recent cycle wrongly demoted.

  It also APPENDS the competitor buyer->seller edges it finds into the census
  (buyer_seller_log.jsonl) so competitor_buyer_targeting finally sees deep in-lane
  buyers instead of a 20-min sample.

Ground-truth only; degrades OPEN (missing input => explicit status, never silent 0).
Usage: python3 -I scripts/onchain_demand_by_lane.py [--max-competitors N]
Secret: TRAFFIC_STATS_SECRET via env, else 1Password (Division vault).
"""
import collections
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PAYTO = os.path.join(HERE, "competitor_payto.json")
CENSUS = os.path.expanduser("~/.hermes/data/x402-demand/buyer_seller_log.jsonl")
OUT = os.path.expanduser("~/.hermes/data/x402-demand/onchain_demand_by_lane.json")
BASE = "https://x402-data-api.sigrunner.workers.dev"
WELLKNOWN = BASE + "/.well-known/x402"
OP_ITEM = "byllgy4p3b27hrscwcdxofe6e4"  # TRAFFIC_STATS_SECRET, Division vault

OUR_WALLETS = {
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10",
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e",
    "0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685",
}

# Same lane map as competitor_buyer_targeting (config/data, matched vs live
# catalogue — NOT a decision gate; a new lane degrades to "no-match", reported).
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


def get_secret():
    s = os.environ.get("TRAFFIC_STATS_SECRET")
    if s:
        return s.strip()
    try:
        r = subprocess.run(
            ["op", "item", "get", OP_ITEM, "--vault", "Division", "--fields", "credential", "--reveal"],
            capture_output=True, text=True, timeout=30)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
        log("op read failed:", r.stderr.strip()[:120])
    except Exception as e:
        log("op exec failed:", e)
    return None


def fetch_catalogue():
    try:
        req = urllib.request.Request(WELLKNOWN, headers={"User-Agent": "greyridge-demand/1.0"})
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


def lane_of(url):
    u = (url or "").lower()
    if NOT_OUR_DOMAIN.search(u):
        return None
    for name, rx, _ in LANE_RULES:
        if rx.search(u):
            return name
    return None


def our_route_for(lane, catalogue):
    cands = {n: r for n, _, r in LANE_RULES}.get(lane, [])
    best = None
    for path in cands:
        price = catalogue.get(path)
        if path in catalogue and price is not None and (best is None or price < best[1]):
            best = (path, price)
    if best is None and cands:
        return (cands[0], catalogue.get(cands[0]))
    return best or (None, None)


def scan_payto(addr, secret):
    """Incoming USDC settlements to a competitor payTo, via our CF-egress worker."""
    # all=1 (every match in window), modest max_chunks to keep per-call latency
    # bounded — Blockscout 403s from CF lately so this always hits the getLogs
    # fallback; ~15*800 blocks ~= recent window, enough for a live demand signal.
    url = (f"{BASE}/internal/find-settlement?to={addr}&all=1&max_chunks=15"
           f"&secret={urllib.parse.quote(secret)}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "greyridge-demand/1.0"})
        d = json.load(urllib.request.urlopen(req, timeout=40))
    except Exception as e:
        return None, str(e)[:100]
    if not d.get("ok"):
        return None, str(d.get("error") or d)[:100]
    return d.get("settlements", []), None


def main():
    max_comp = 200
    if "--max-competitors" in sys.argv:
        try:
            max_comp = int(sys.argv[sys.argv.index("--max-competitors") + 1])
        except Exception:
            pass

    now = datetime.datetime.now(datetime.timezone.utc)
    result = {"generated_at": now.isoformat(), "status": "ok", "alert": False, "method":
              "worker /internal/find-settlement (Blockscout from CF egress) per competitor payTo"}

    if not os.path.exists(PAYTO):
        result.update(status="degraded", reason="no competitor_payto.json")
        emit(result)
        return
    secret = get_secret()
    if not secret:
        result.update(status="degraded", reason="no TRAFFIC_STATS_SECRET (env or 1Password)")
        emit(result)
        return

    catalogue = fetch_catalogue()
    result["our_catalogue_routes"] = len(catalogue)

    payto = json.load(open(PAYTO))
    # competitor seller -> (lane, url, charged_usdc_per_call)
    targets = []
    for row in payto:
        try:
            addr, url, price_micro = row[0].lower(), row[1], row[2]
        except Exception:
            continue
        lane = lane_of(url)
        if not lane:
            continue
        per_call = None
        try:
            if price_micro is not None:
                per_call = float(price_micro) / 1e6
        except (TypeError, ValueError):
            per_call = None
        targets.append((addr, url, lane, per_call))
    # dedup by addr (a seller can expose many routes); keep first lane/url/price
    seen = set()
    uniq = []
    for t in targets:
        if t[0] in seen:
            continue
        seen.add(t[0])
        uniq.append(t)
    uniq = uniq[:max_comp]
    result["competitors_in_our_lanes"] = len(uniq)

    lanes = collections.defaultdict(lambda: {"usdc": 0.0, "calls": 0, "buyers": collections.Counter(),
                                             "competitors": [], "max_per_call": 0.0})
    new_edges = []
    scanned = ok = 0
    today = now.strftime("%Y-%m-%d")
    for addr, url, lane, per_call in uniq:
        scanned += 1
        settles, err = scan_payto(addr, secret)
        if settles is None:
            continue
        ok += 1
        comp_usdc = 0.0
        comp_buyers = set()
        for s in settles:
            frm = (s.get("from") or "").lower()
            if not frm.startswith("0x") or len(frm) != 42:
                continue
            if frm in OUR_WALLETS:
                continue
            amt = float(s.get("amount_usdc") or 0)
            L = lanes[lane]
            L["usdc"] += amt
            L["calls"] += 1
            L["buyers"][frm] += 1
            comp_usdc += amt
            comp_buyers.add(frm)
            new_edges.append({"d": today, "b": frm, "s": addr})
        if per_call:
            lanes[lane]["max_per_call"] = max(lanes[lane]["max_per_call"], per_call)
        if comp_usdc > 0:
            lanes[lane]["competitors"].append({"payTo": addr, "url": url, "per_call_usdc": per_call,
                                               "external_usdc": round(comp_usdc, 4),
                                               "distinct_buyers": len(comp_buyers)})
    result["competitors_scanned"] = scanned
    result["competitors_scanned_ok"] = ok

    # Build lane ranking with our cheaper equivalent + advantage multiple.
    ranking = []
    for lane, L in lanes.items():
        our_path, our_price = our_route_for(lane, catalogue)
        adv = None
        if our_price and L["max_per_call"]:
            adv = round(L["max_per_call"] / our_price, 1)
        ranking.append({
            "lane": lane,
            "external_usdc_observed": round(L["usdc"], 4),
            "external_calls_observed": L["calls"],
            "distinct_external_buyers": len(L["buyers"]),
            "top_buyers": [{"addr": b, "calls": n} for b, n in L["buyers"].most_common(5)],
            "competitor_max_per_call_usdc": round(L["max_per_call"], 6) or None,
            "our_cheapest_route": our_path,
            "our_price_usdc": our_price,
            "our_price_advantage_x": adv,
            "live_competitors": sorted(L["competitors"], key=lambda c: -c["external_usdc"])[:5],
        })
    ranking.sort(key=lambda r: (-r["external_usdc_observed"], -r["distinct_external_buyers"]))
    result["lanes"] = ranking

    hot = [r for r in ranking if r["distinct_external_buyers"] >= 1 and r["external_usdc_observed"] > 0]
    result["alert"] = bool(hot)
    if hot:
        top = hot[0]
        result["headline"] = (
            f"LIVE external demand in lane '{top['lane']}': "
            f"{top['distinct_external_buyers']} buyer(s), ${top['external_usdc_observed']} observed, "
            f"competitor charges up to ${top['competitor_max_per_call_usdc']}/call — "
            f"we serve {top['our_cheapest_route']} at ${top['our_price_usdc']} "
            f"({top['our_price_advantage_x']}x cheaper). Keep this lane surfaced."
        )
    else:
        result["headline"] = "No external paying demand observed on scanned competitor payTo this run."

    # Persist newly-seen competitor buyer->seller edges into the census so
    # competitor_buyer_targeting sees deep in-lane buyers (dedup against existing).
    appended = 0
    if new_edges:
        os.makedirs(os.path.dirname(CENSUS), exist_ok=True)
        existing = set()
        if os.path.exists(CENSUS):
            for line in open(CENSUS):
                try:
                    r = json.loads(line)
                    existing.add((r.get("d"), r.get("b"), r.get("s")))
                except Exception:
                    continue
        with open(CENSUS, "a") as f:
            for e in new_edges:
                key = (e["d"], e["b"], e["s"])
                if key in existing:
                    continue
                existing.add(key)
                f.write(json.dumps(e) + "\n")
                appended += 1
    result["census_edges_appended"] = appended

    emit(result)


def emit(result):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(result, open(OUT, "w"), indent=2)
    print(json.dumps({k: v for k, v in result.items() if k != "lanes"}, indent=2))
    for r in result.get("lanes", []):
        print(f"  [{r['lane']}] ${r['external_usdc_observed']} / {r['distinct_external_buyers']} buyers"
              f" | comp ${r['competitor_max_per_call_usdc']}/call -> us {r['our_cheapest_route']} "
              f"${r['our_price_usdc']} ({r['our_price_advantage_x']}x)")


if __name__ == "__main__":
    main()
