#!/usr/bin/env python3
"""external_payer_routes.py — the route-level demand truth the goal needs.

/metrics' net_external tells you HOW MANY external wallets paid and their
addresses, but not WHICH route each one bought or whether any came back. That
distinction is the whole game: a wallet that hits seven different cheap routes
exactly once is a catalog-enumeration bot; a wallet that hits one route
repeatedly is a real recurring need. This script joins the two — it pulls the
per-(path,payer) paid aggregate from the TrafficLog store, filters to the
non-self external payers, prices each route from ROUTE_CATALOG in src/index.ts,
and prints per-payer totals plus a repeat-buy flag.

Run it every cycle as the x402-rail demand sensor: the ONLY new-lead signal on
the agent rail is a NEW external wallet, or an existing one buying the SAME
route more than once. Absent that, the rail is dust and the money is a human
fiat subscription (see docs/DEMAND_RESEARCH.md).

Usage:
  python3 -I scripts/external_payer_routes.py [--hours 720] [--json]

Secret resolution (first hit wins):
  $TRAFFIC_STATS_SECRET  |  op://Division/TRAFFIC_STATS_SECRET/credential
  |  ~/.hermes/data/x402-data-api/traffic_secret.txt
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

BASE = os.environ.get("X402_BASE", "https://api.greyridgesignals.ai")
SELF = {
    "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10",
    "0xc4852c26498d3187dec2ce1b19e840710e302d1e",
    "0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685",
}


def repo_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def route_prices():
    """Parse ROUTE_CATALOG tuples [path, method, price, ...] from src/index.ts."""
    src = open(os.path.join(repo_root(), "src", "index.ts")).read()
    m = re.search(r"const ROUTE_CATALOG[^=]*=\s*\[(.*?)\n\];", src, re.S)
    prices = {}
    if not m:
        return prices
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line.startswith("["):
            continue
        s = re.findall(r'"([^"]*)"', line)
        if len(s) >= 3 and s[0].startswith("/"):
            try:
                prices[s[0]] = float(s[2])
            except ValueError:
                pass
    return prices


def secret():
    s = os.environ.get("TRAFFIC_STATS_SECRET", "").strip()
    if s:
        return s
    try:
        s = subprocess.check_output(
            ["op", "read", "op://Division/TRAFFIC_STATS_SECRET/credential"],
            stderr=subprocess.DEVNULL, timeout=20,
        ).decode().strip()
        if s:
            return s
    except Exception:
        pass
    path = os.path.expanduser("~/.hermes/data/x402-data-api/traffic_secret.txt")
    try:
        return open(path).read().strip()
    except Exception:
        return ""


def fetch(hours, sec):
    url = f"{BASE}/internal/traffic-stats?window_hours={hours}&paid=1&secret={sec}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=35) as r:
        return json.load(r)


def main(argv):
    hours = 720
    as_json = "--json" in argv
    if "--hours" in argv:
        hours = int(argv[argv.index("--hours") + 1])
    sec = secret()
    if not sec:
        print("ERROR: no TRAFFIC_STATS_SECRET (env / 1Password / local cache)")
        return 1
    try:
        d = fetch(hours, sec)
    except Exception as e:
        print(f"ERROR: fetch failed: {e}")
        return 1
    if not d.get("ok"):
        print("NOT OK:", json.dumps(d)[:300])
        return 1
    prices = route_prices()
    payers = {}
    for row in d.get("paid", []):
        p = str(row.get("payer", "")).lower()
        if p in ("", "unknown") or p in SELF:
            continue
        payers.setdefault(p, []).extend([row.get("path")] * int(row.get("count", 1)))
    total = 0.0
    out = []
    for p, routes in sorted(payers.items(), key=lambda kv: -len(kv[1])):
        calls = len(routes)
        distinct = len(set(routes))
        amt = sum(prices.get(r, 0.0) for r in routes)
        total += amt
        repeat = calls > distinct
        out.append({
            "payer": p, "calls": calls, "distinct_routes": distinct,
            "usdc": round(amt, 6), "repeat_buyer": repeat,
            "routes": sorted(set(routes)),
        })
    summary = {
        "window_hours": hours,
        "external_payers": len(out),
        "total_external_usdc": round(total, 6),
        "per_day_usdc": round(total / (hours / 24.0), 6) if hours else 0,
        "any_repeat_buyer": any(o["repeat_buyer"] for o in out),
        "payers": out,
    }
    if as_json:
        print(json.dumps(summary, indent=2))
        return 0
    print(f"=== external payer routes — last {hours}h ({hours/24:.0f}d) ===")
    for o in out:
        flag = "REPEAT-BUYER" if o["repeat_buyer"] else "one-shot (each route once)"
        print(f"{o['payer']}  {o['calls']} calls / {o['distinct_routes']} routes / "
              f"${o['usdc']:.4f}  [{flag}]")
        for r in o["routes"]:
            print(f"     {r}  (${prices.get(r,0):.4f})")
    print(f"--- {summary['external_payers']} external payers · "
          f"${summary['total_external_usdc']:.4f} / {hours/24:.0f}d · "
          f"${summary['per_day_usdc']:.5f}/day · "
          f"repeat-buyer seen: {summary['any_repeat_buyer']} ---")
    if not summary["any_repeat_buyer"]:
        print("VERDICT: agent rail is dust (no recurring external demand). "
              "Money is a human fiat subscription; x402 = invisible backend supply.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
