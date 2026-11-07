#!/usr/bin/env python3
"""worker_ledger_revenue.py — RPC-free external-revenue term from the Worker's own ledger.

Why: the on-chain revenue sensor (~/.hermes/scripts/x402_revenue_sensor.py) is throttled by
public Base RPCs and can sit tens of days behind tip (2026-11-07: stuck at block 50830131,
~79 days behind). Everything it has not scanned is invisible to it. The Worker records
every paid call it served in TrafficLog with the on-chain payer address, so the same
revenue can be counted without any RPC.

What it does (read-only, no signing, no spend):
  1. GET <base>/.well-known/x402            -> advertised price per route (== charged price,
                                               enforced by scripts/price_consistency_sensor.py)
  2. GET <base>/internal/traffic-stats?paid=1 -> per-(path, payer) paid counts (secret via the
                                               same resolver chain as external_payer_routes.py)
  3. GET <base>/metrics                     -> net_external block (cross-check of the count)
Self wallets (buyer wallet, PAY_TO, relay) are excluded. Output is written to
~/.hermes/data/x402-revenue/worker_ledger.json.

Honest limits (also written into the output):
  * TrafficLog aggregates carry NO per-row timestamp, so this cannot be de-duplicated against
    the chain scan by block. revenue_ledger_plus_chain_usdc is therefore an UPPER bound for the
    overlap period; treat ledger_usdc alone as the number for the Worker's logging window.
  * A ledger row is a call the Worker served after payment verification; a settlement that
    later failed on-chain would still be in the ledger. Reconcile with the chain scan.
  * It never replaces revenue_usd_corrected; promotion into that gap metric is a human call.

Usage:
  python3 -I scripts/worker_ledger_revenue.py [--hours 720] [--write] [--json]
Exit codes: 0 ok, 1 fetch/secret failure (loud, with the real cause), 2 bad usage.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import external_payer_routes as epr  # noqa: E402  (reuse secret resolver + SELF set; adopt, not invent)

BASE = os.environ.get("X402_BASE", "https://api.greyridgesignals.ai")
OUT_PATH = os.path.expanduser("~/.hermes/data/x402-revenue/worker_ledger.json")
CHAIN_LATEST = os.path.expanduser("~/.hermes/data/x402-revenue/latest.json")
UA = {"User-Agent": "Mozilla/5.0"}


def _get_json(url, timeout=35):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def normalize_path(p):
    """TrafficLog stores templated paths ('/dns/{domain}'); the manifest lists '/dns'."""
    return re.sub(r"/\{[^}]+\}$", "", p or "")


def manifest_prices(manifest):
    """{path: usdc_float} from the /.well-known/x402 resources[] list."""
    out = {}
    for r in manifest.get("resources", []) or []:
        url = r.get("resource", "")
        m = re.match(r"https?://[^/]+(/.*)$", url)
        try:
            price = float(r.get("price_usdc"))
        except (TypeError, ValueError):
            continue
        if m:
            out[m.group(1)] = price
    return out


def build_ledger(paid_rows, prices, self_wallets):
    """Pure function: aggregate external paid rows into the ledger summary."""
    selfs = {s.lower() for s in self_wallets}
    per_route = {}
    per_payer = {}
    unpriced = {}
    self_calls = 0
    unknown_calls = 0
    for row in paid_rows:
        payer = str(row.get("payer", "")).lower()
        count = int(row.get("count", 1) or 1)
        path = normalize_path(row.get("path"))
        if payer in selfs:
            self_calls += count
            continue
        if payer in ("", "unknown"):
            unknown_calls += count
            continue
        price = prices.get(path)
        if price is None:
            unpriced[path] = unpriced.get(path, 0) + count
            price = 0.0
        r = per_route.setdefault(path, {"calls": 0, "usdc": 0.0, "payers": {}, "price_usdc": price})
        r["calls"] += count
        r["usdc"] += count * price
        r["payers"][payer] = r["payers"].get(payer, 0) + count
        p = per_payer.setdefault(payer, {"calls": 0, "usdc": 0.0, "routes": {}})
        p["calls"] += count
        p["usdc"] += count * price
        p["routes"][path] = p["routes"].get(path, 0) + count
    routes_out = []
    for path, r in sorted(per_route.items(), key=lambda kv: -kv[1]["usdc"]):
        repeat_payers = sum(1 for c in r["payers"].values() if c > 1)
        routes_out.append({
            "path": path, "price_usdc": r["price_usdc"], "calls": r["calls"],
            "usdc": round(r["usdc"], 6), "distinct_payers": len(r["payers"]),
            "same_route_repeat_payers": repeat_payers,
            "same_route_repeat_rate": round(repeat_payers / len(r["payers"]), 3) if r["payers"] else 0.0,
        })
    payers_out = []
    for addr, p in sorted(per_payer.items(), key=lambda kv: -kv[1]["calls"]):
        payers_out.append({
            "payer": addr, "calls": p["calls"], "usdc": round(p["usdc"], 6),
            "distinct_routes": len(p["routes"]),
            # a wallet that touches many cheap routes once each is a catalogue sweep, not a customer
            "catalogue_sweep": len(p["routes"]) >= 3 and max(p["routes"].values()) <= 2,
        })
    ext_calls = sum(r["calls"] for r in per_route.values())
    return {
        "external_calls": ext_calls,
        "ledger_usdc": round(sum(r["usdc"] for r in per_route.values()), 6),
        "distinct_external_payers": len(per_payer),
        "payers_same_route_repeat": sum(1 for p in per_payer.values() if any(c > 1 for c in p["routes"].values())),
        "payers_catalogue_sweep": sum(1 for p in payers_out if p["catalogue_sweep"]),
        "self_calls": self_calls,
        "unknown_calls": unknown_calls,
        "unpriced_routes": unpriced,
        "by_route": routes_out,
        "by_payer": payers_out,
    }


def read_chain_total(path=CHAIN_LATEST):
    try:
        return float(json.load(open(path)).get("total_external_usdc", 0.0))
    except Exception:
        return None


def run(hours=720, base=BASE, secret_fn=None, fetch=_get_json, chain_path=CHAIN_LATEST, now=None):
    now = int(now if now is not None else time.time())
    sec = (secret_fn or epr.secret)()
    if not sec:
        raise RuntimeError("no TRAFFIC_STATS_SECRET (env / secret_resolve / 1Password / local cache)")
    manifest = fetch(f"{base}/.well-known/x402")
    prices = manifest_prices(manifest)
    if not prices:
        raise RuntimeError("manifest /.well-known/x402 yielded zero priced routes")
    stats = fetch(f"{base}/internal/traffic-stats?window_hours={hours}&paid=1&secret={sec}")
    if not stats.get("ok"):
        raise RuntimeError("traffic-stats not ok: " + json.dumps(stats)[:200])
    ledger = build_ledger(stats.get("paid", []), prices, epr.SELF)
    metrics_ext = None
    try:
        metrics_ext = (fetch(f"{base}/metrics").get("net_external") or {}).get("external_calls")
    except Exception as e:  # cross-check only; never fail the ledger on it
        print(f"worker_ledger_revenue: /metrics cross-check unavailable: {e}", file=sys.stderr)
    onchain = read_chain_total(chain_path)
    out = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "window_hours": hours,
        "window_start_ts": now - hours * 3600,
        "source": "Worker TrafficLog via /internal/traffic-stats (paid=1), priced from /.well-known/x402",
        **ledger,
        "metrics_net_external_calls": metrics_ext,
        "ledger_vs_metrics_call_delta": (None if metrics_ext is None else ledger["external_calls"] - int(metrics_ext)),
        "onchain_usdc": onchain,
        "revenue_ledger_plus_chain_usdc": (None if onchain is None else round(onchain + ledger["ledger_usdc"], 6)),
        "confidence": "lower than chain: no per-row timestamps, so overlap with onchain_usdc cannot be removed "
                      "(plus-chain is an UPPER bound). Never promoted into revenue_usd_corrected automatically.",
    }
    return out


def main(argv):
    hours = 720
    if "--hours" in argv:
        try:
            hours = int(argv[argv.index("--hours") + 1])
        except (IndexError, ValueError):
            print("usage: --hours <int>", file=sys.stderr)
            return 2
    try:
        out = run(hours=hours)
    except (urllib.error.URLError, RuntimeError, ValueError, OSError) as e:
        print(f"worker_ledger_revenue: FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    if "--write" in argv:
        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        tmp = OUT_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(out, f, indent=2)
        os.replace(tmp, OUT_PATH)
        print(f"wrote {OUT_PATH}")
    if "--json" in argv or "--write" not in argv:
        print(json.dumps(out, indent=2))
    else:
        print(f"external_calls={out['external_calls']} ledger_usdc={out['ledger_usdc']} "
              f"payers={out['distinct_external_payers']} sweeps={out['payers_catalogue_sweep']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
