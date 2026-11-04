#!/usr/bin/env python3
"""
bazaar_demand_sensor.py — REAL per-route paying demand, read from the CDP x402
Bazaar's own accounting (quality block), not from our on-chain RPC scan.

WHY: the committed demand signal the live product reads (src/demand_snapshot.ts,
written by external_payer_routes.py) is generated from a Base eth_getLogs scan
that routinely stops early on public-RPC 403/429 (see ~/.hermes/data/x402-revenue/
latest.json "scan stopped early ...") and goes stale between runs. The CDP Bazaar
discovery/resources list carries, per registered resource, a `quality` block:
  { l30DaysTotalCalls, l30DaysUniquePayers, lastCalledAt }
That is CDP's OWN settlement accounting for every route we have live — complete,
current, keyless, and it also exposes lastCalledAt (a recency signal the RPC scan
does not cleanly give). This sensor reads it so the loop's demand intelligence and
the WTP price-floor / cross-sell ordering stop running on a truncated 7-day-stale
scan.

WHAT: GET the CDP discovery/resources list (paginated, sorted newest-first), keep
only rows whose accepts[].payTo is our receiving wallet, and for each read the
route URL, atomic price, 30d calls, 30d unique payers, lastCalledAt. Compute
gross_usd_30d = calls * price. 0 self-pay, read-only.

OUTPUT: ~/.hermes/data/x402-revenue/bazaar_demand.json
  { generated_at, source, window_days, scanned_items, routes:[...], totals:{...} }

--write-snapshot: regenerate src/demand_snapshot.ts. external_by_route is the
UNION of the existing committed snapshot and CDP's unique-payer counts, taking the
MAX per route — so we NEVER drop protection a route already had (barbell: never
churn unseen demand) while folding in CDP's superior completeness + currency.

Exit code: 0 always (sensor; never blocks a cron). Usage:
  python3 -I scripts/bazaar_demand_sensor.py [--write-snapshot] [--window N]
"""
import datetime
import json
import os
import re
import subprocess
import sys

PAY_TO = "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10"
BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources"
OUT_DIR = os.path.join(os.path.expanduser("~"), ".hermes", "data", "x402-revenue")
OUT = os.path.join(OUT_DIR, "bazaar_demand.json")
PAGE = 2000
DEFAULT_WINDOW = 20000  # items scanned, newest-first; our live routes sort recent


def repo_root():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(here)


def _get(url):
    """curl, not urllib: the CF edge in front of CDP 1010s a bare python UA."""
    try:
        out = subprocess.run(
            ["curl", "-s", "--max-time", "25", url],
            capture_output=True, text=True, timeout=30,
        ).stdout
        return json.loads(out)
    except Exception:
        return None


def _is_ours(item):
    for a in item.get("accepts", []) or []:
        if str(a.get("payTo") or "").lower() == PAY_TO:
            return a
    return None


def collect(window):
    rows = {}
    scanned = 0
    total = None
    for off in range(0, window, PAGE):
        d = _get(f"{BASE}?limit={PAGE}&offset={off}")
        if not d:
            continue
        if total is None:
            total = (d.get("pagination") or {}).get("total")
        items = d.get("items") or []
        if not items:
            break
        scanned += len(items)
        for it in items:
            acc = _is_ours(it)
            if not acc:
                continue
            res = it.get("resource")
            if not isinstance(res, str) or not res:
                continue
            q = it.get("quality") or {}
            amt = acc.get("amount") or (it.get("accepts", [{}])[0].get("amount"))
            try:
                price = int(amt) / 1_000_000 if amt is not None else None
            except (TypeError, ValueError):
                price = None
            calls = q.get("l30DaysTotalCalls")
            payers = q.get("l30DaysUniquePayers")
            # Keep the richer row if the same route appears twice (host variants).
            prev = rows.get(res)
            cand = {
                "route": res,
                "path": "/" + res.split("/", 3)[3] if res.count("/") >= 3 else res,
                "amount_usdc": price,
                "calls_30d": calls or 0,
                "payers_30d": payers or 0,
                "gross_usd_30d": round((calls or 0) * price, 6) if price is not None else None,
                "last_called_at": q.get("lastCalledAt"),
                "service_name": it.get("serviceName"),
            }
            if prev is None or (cand["payers_30d"] or 0) >= (prev["payers_30d"] or 0):
                rows[res] = cand
        if total is not None and off + PAGE >= total:
            break
    return list(rows.values()), scanned, total


def _norm_path(route):
    # https://host/a/b?x=1 -> /a/b  (route key the product catalog uses)
    m = re.match(r"https?://[^/]+(/[^?#]*)", route)
    return (m.group(1) if m else route).rstrip("/") or "/"


def existing_snapshot():
    """Parse the committed external_by_route so we never drop prior protection."""
    path = os.path.join(repo_root(), "src", "demand_snapshot.ts")
    out = {}
    try:
        txt = open(path).read()
        body = txt.split("external_by_route:", 1)[1]
        for m in re.finditer(r'"([^"]+)":\s*(\d+)', body):
            out[m.group(1)] = int(m.group(2))
    except Exception:
        pass
    return out


def write_snapshot(routes):
    """Regenerate src/demand_snapshot.ts = union-max(existing, CDP payers)."""
    import collections
    byroute = collections.Counter(existing_snapshot())
    for r in routes:
        p = _norm_path(r["route"])
        byroute[p] = max(byroute.get(p, 0), int(r.get("payers_30d") or 0))
    byroute = {k: v for k, v in byroute.items() if v >= 1}
    ordered = sorted(byroute.items(), key=lambda kv: (-kv[1], kv[0]))
    gen = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "// AUTO-GENERATED by scripts/external_payer_routes.py --write-snapshot",
        "// and scripts/bazaar_demand_sensor.py --write-snapshot (union-max merge).",
        "// Do NOT hand-edit. external_by_route[path] = distinct external payers who",
        "// paid that route in the 30d window, from the CDP x402 Bazaar quality block",
        "// (l30DaysUniquePayers) merged with the on-chain revenue sensor (max per",
        "// route, so a route never loses protection). The discovery manifest, the",
        "// WTP price floor and the see_also cross-sell order by this signal — never",
        "// a static priority list.",
        "export const DEMAND_SNAPSHOT = {",
        f'  generated_at: "{gen}",',
        "  window_days: 30,",
        "  external_by_route: {",
    ]
    for r, n in ordered:
        lines.append(f'    "{r}": {n},')
    lines += ["  } as Record<string, number>,", "};", ""]
    path = os.path.join(repo_root(), "src", "demand_snapshot.ts")
    with open(path, "w") as f:
        f.write("\n".join(lines))
    return path, len(ordered)


def main(argv):
    window = DEFAULT_WINDOW
    if "--window" in argv:
        try:
            window = int(argv[argv.index("--window") + 1])
        except (ValueError, IndexError):
            pass
    routes, scanned, total = collect(window)
    routes.sort(key=lambda r: (-(r["payers_30d"] or 0), -(r["calls_30d"] or 0)))
    gross = sum(r["gross_usd_30d"] or 0 for r in routes)
    tot_calls = sum(r["calls_30d"] or 0 for r in routes)
    tot_payers = sum(r["payers_30d"] or 0 for r in routes)
    gen = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    doc = {
        "generated_at": gen,
        "source": "cdp_x402_bazaar_discovery_resources.quality",
        "window_days": 30,
        "pay_to": PAY_TO,
        "scanned_items": scanned,
        "bazaar_total_items": total,
        "routes": routes,
        "totals": {
            "indexed_routes": len(routes),
            "calls_30d": tot_calls,
            "payer_slots_30d": tot_payers,
            "gross_usd_30d": round(gross, 6),
        },
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, indent=2)

    print(f"CDP Bazaar demand — {len(routes)} indexed routes "
          f"(scanned {scanned} of {total} items)")
    print(f"{'route':48} {'$':>7} {'calls':>6} {'payers':>7}  {'gross$':>8}  last")
    for r in routes:
        print(f"{_norm_path(r['route']):48} "
              f"{(r['amount_usdc'] or 0):>7.3f} {r['calls_30d']:>6} "
              f"{r['payers_30d']:>7}  {(r['gross_usd_30d'] or 0):>8.4f}  "
              f"{str(r['last_called_at'])[:10]}")
    print(f"\nTOTAL: {tot_calls} calls, {tot_payers} payer-slots, "
          f"${gross:.4f} gross (30d) -> {OUT}")

    if "--write-snapshot" in argv:
        p, n = write_snapshot(routes)
        print(f"wrote {p} ({n} routes with >=1 payer)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:  # sensor: never blocks a cron
        print(f"bazaar_demand_sensor error (degrade-open): {e}", file=sys.stderr)
        sys.exit(0)
