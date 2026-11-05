#!/usr/bin/env python3
"""Append a price tick to the git-committed provenance archive, then bake it into
a TS module the Worker imports.

The TIME moat needs a RELIABLE persistence substrate. Cloudflare KV free-tier
put() is daily-capped and eventually-consistent, so a KV-only archive churns its
first_seen and never compounds (proven live 2026-11-05). The durable pattern in
this repo — status_report.py -> src/status_snapshot.ts, baked into the bundle and
deployed by CI — has no write limit, is deterministic, and is publicly verifiable
in-repo (itself a provenance signal). We mirror it: this cron appends one tick per
flagship coin per run to data/provenance_archive.json and regenerates
src/provenance_snapshot.ts. The Worker merges this committed history with any
best-effort live KV tick, so the archive compounds with age regardless of KV.

Run (cron, ~every 6h):  python3 -I scripts/provenance_snapshot.py
"""
import datetime
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ARCHIVE = os.path.join(ROOT, "data", "provenance_archive.json")
TS_OUT = os.path.join(ROOT, "src", "provenance_snapshot.ts")

# Flagship coins we commit to tracking durably. The teaser samples bitcoin; the
# wider set gives the paid route real provenance coverage for the coins agents
# most often price. CoinGecko ids (DefiLlama's price key namespace).
COINS = [
    "bitcoin", "ethereum", "solana", "usd-coin", "tether",
    "binancecoin", "ripple", "cardano", "dogecoin", "avalanche-2",
]
TICK_CAP = 48  # must match ARCH_TICK_CAP in src/provenance.ts

# How many of the highest-TVL DefiLlama pools we commit to tracking durably for
# the `yield` series. /defi/yields is our #1 external payer route; the top-TVL
# pools (Lido, Aave, the big LPs) are the stable set agents most often query, and
# their poolIds are long-lived — so an APY trajectory keyed by poolId compounds.
YIELD_TOP_N = 40


def fetch_prices(ids):
    path = ",".join(f"coingecko:{i}" for i in ids)
    url = f"https://coins.llama.fi/prices/current/{path}"
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "grey-ridge-provenance/1.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        data = json.load(r)
    out = {}
    coins = data.get("coins", {}) or {}
    for i in ids:
        c = coins.get(f"coingecko:{i}")
        if c and isinstance(c.get("price"), (int, float)):
            out[i] = float(c["price"])
    return out


def select_top_yields(pools, top_n):
    """Pure: {poolId: apy} for the top_n highest-TVL pools carrying a finite APY +
    stable poolId. Rank by TVL desc; a pool missing a numeric tvl/apy/pool is
    skipped (never seeds a junk tick). Kept side-effect-free so it is unit-tested
    without network, mirroring the Worker's degrade-open fetchDefiYields."""
    ranked = sorted(
        (p for p in pools if isinstance(p.get("tvlUsd"), (int, float)) and not isinstance(p.get("tvlUsd"), bool)),
        key=lambda p: p["tvlUsd"],
        reverse=True,
    )
    out = {}
    for p in ranked:
        pid = p.get("pool")
        apy = p.get("apy")
        if isinstance(pid, str) and pid and isinstance(apy, (int, float)) and not isinstance(apy, bool):
            out[pid] = float(apy)
        if len(out) >= top_n:
            break
    return out


def fetch_yields(top_n):
    """Return {poolId: apy} for the top_n highest-TVL DefiLlama pools that carry a
    finite APY. Same upstream the Worker's fetchDefiYields uses, so the committed
    series matches the live route's universe. Degrade-open."""
    url = "https://yields.llama.fi/pools"
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "grey-ridge-provenance/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    pools = data.get("data", []) or []
    return select_top_yields(pools, top_n)


def load_archive():
    try:
        with open(ARCHIVE) as f:
            a = json.load(f)
        if isinstance(a, dict) and isinstance(a.get("series"), dict):
            return a
    except Exception:
        pass
    return {"schema": 1, "series": {"price": {}}, "generated_at": None}


def tick_series(archive, series_name, values, now_ms):
    """Append one tick per id into archive['series'][series_name], starting a
    record on first sight and capping each record at TICK_CAP. Returns the number
    of ids ticked. Shared by the price and yield series so both compound by the
    same bounded, append-only rule."""
    series = archive["series"].setdefault(series_name, {})
    appended = 0
    for sid, val in values.items():
        rec = series.get(sid)
        if not rec or not isinstance(rec.get("ticks"), list) or not rec["ticks"]:
            series[sid] = {"first_seen": now_ms, "ticks": [{"t": now_ms, "v": val}]}
            appended += 1
            continue
        rec["ticks"].append({"t": now_ms, "v": val})
        if len(rec["ticks"]) > TICK_CAP:
            rec["ticks"] = rec["ticks"][-TICK_CAP:]
        appended += 1
    return appended


def main():
    now_ms = int(datetime.datetime.now(datetime.UTC).timestamp() * 1000)
    now_iso = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Each series fetches independently and degrades open — a failure or empty
    # result in one NEVER corrupts the archive or blocks the other series.
    try:
        prices = fetch_prices(COINS)
    except Exception as e:
        print(f"provenance_snapshot: price fetch failed ({e}); prices skipped", file=sys.stderr)
        prices = {}
    try:
        yields = fetch_yields(YIELD_TOP_N)
    except Exception as e:
        print(f"provenance_snapshot: yield fetch failed ({e}); yields skipped", file=sys.stderr)
        yields = {}

    if not prices and not yields:
        print("provenance_snapshot: no data returned for any series; archive untouched", file=sys.stderr)
        return 0

    archive = load_archive()
    appended = 0
    if prices:
        appended += tick_series(archive, "price", prices, now_ms)
    if yields:
        appended += tick_series(archive, "yield", yields, now_ms)
    price_series = archive["series"].setdefault("price", {})
    yield_series = archive["series"].setdefault("yield", {})

    archive["generated_at"] = now_iso
    os.makedirs(os.path.dirname(ARCHIVE), exist_ok=True)
    with open(ARCHIVE, "w") as f:
        json.dump(archive, f, indent=2)

    ts = (
        "// AUTO-GENERATED by scripts/provenance_snapshot.py — do not edit by hand.\n"
        "// The TIME moat: a git-committed, CI-deployed price-tick archive the Worker\n"
        "// merges with best-effort live KV ticks. Reliable where KV free-tier is not.\n"
        "import type { ProvRecord } from \"./provenance.ts\";\n"
        "export const PROVENANCE_SNAPSHOT: { schema: number; generated_at: string;"
        " series: Record<string, Record<string, ProvRecord>> } =\n"
        + json.dumps({"schema": archive.get("schema", 1), "generated_at": now_iso, "series": archive["series"]}, indent=2)
        + " as const;\n"
    )
    with open(TS_OUT, "w") as f:
        f.write(ts)

    price_ticks = sum(len(r["ticks"]) for r in price_series.values())
    yield_ticks = sum(len(r["ticks"]) for r in yield_series.values())
    print(
        f"provenance_snapshot: {appended} ids ticked | price: {len(price_series)} coins/{price_ticks} ticks | "
        f"yield: {len(yield_series)} pools/{yield_ticks} ticks -> {TS_OUT}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
