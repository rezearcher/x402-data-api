#!/usr/bin/env python3
"""Sample the CDP discovery index for /chain/token-security on a fixed interval.

Purpose (card t_d5138bac): the re-listing verdict hinges on WHEN the async
extension leg lands, not just whether it has landed by an arbitrary deadline.
Docs claimed "phase-one lag is <=15 min"; the 06:02Z settlement was still
unreflected at 06:57Z (55 min), so a single 30-min snapshot cannot distinguish
"slow" from "broken". This sampler records the trajectory.

Each tick appends one JSON object to a JSONL file with:
  observed_at        sampler wall clock (UTC)
  lastUpdated        record.lastUpdated
  lastCalledAt       quality.lastCalledAt
  calls30d / payers  quality counters
  desc_len           catalog description length (493 = pre-deploy, 415 = post-deploy)
  desc_has_scam      buyer-intent vocabulary present
  ext_output_at      extensions.bazaar.info.output.example.analyzed_at (7/17 = frozen)
  search_ranks       our rank per buyer-intent query (absent = [])

No settlement, no writes, no Worker changes: read-only GETs.
Usage: python3 scripts/probe_cdp_index_latency.py --duration 2400 --interval 60
"""
import argparse
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://api.cdp.coinbase.com/platform/v2/x402/discovery"
PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10"
SETTLED_ROUTE = "/chain/token-security"
QUERIES = ["is this token a scam", "token security", "honeypot detector"]


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def find_record():
    for offset in range(0, 200, 20):
        d = get(f"{API}/merchant?payTo={PAY_TO}&limit=20&offset={offset}")
        for rec in d.get("resources", d.get("items", [])):
            if (rec.get("resource") or "").endswith(SETTLED_ROUTE):
                return rec
    return None


def sample():
    now = datetime.now(timezone.utc)
    out = {"observed_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"}
    try:
        rec = find_record()
    except Exception as e:  # network hiccup must not kill the series
        out["error"] = f"merchant: {type(e).__name__}: {e}"
        return out
    if not rec:
        out["error"] = "record absent from merchant feed"
        return out
    q = rec.get("quality") or {}
    desc = rec.get("description") or ""
    example = (((rec.get("extensions") or {}).get("bazaar") or {}).get("info") or {}).get("output") or {}
    out.update({
        "lastUpdated": rec.get("lastUpdated"),
        "lastCalledAt": q.get("lastCalledAt"),
        "calls30d": q.get("l30DaysTotalCalls"),
        "payers30d": q.get("l30DaysUniquePayers"),
        "desc_len": len(desc),
        "desc_has_scam": "scam" in desc.lower(),
        "ext_output_at": (example.get("example") or {}).get("analyzed_at"),
    })
    ranks = {}
    for query in QUERIES:
        try:
            d = get(f"{API}/search?query={urllib.parse.quote(query)}&limit=20")
            items = d.get("resources", d.get("items", []))
            ranks[query] = {
                "results": len(items),
                "our_ranks": [i + 1 for i, r in enumerate(items)
                              if "sigrunner" in (r.get("resource") or "")],
            }
        except Exception as e:
            ranks[query] = {"error": f"{type(e).__name__}: {e}"}
    out["search"] = ranks
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duration", type=int, default=2400, help="seconds to sample")
    ap.add_argument("--interval", type=int, default=60)
    ap.add_argument("--out", default="logs/cdp-index-latency-probe.jsonl")
    args = ap.parse_args()

    deadline = time.time() + args.duration
    with open(args.out, "a") as fh:
        while True:
            s = sample()
            fh.write(json.dumps(s) + "\n")
            fh.flush()
            print(f"{s['observed_at']} called={s.get('lastCalledAt')} "
                  f"updated={s.get('lastUpdated')} dlen={s.get('desc_len')} "
                  f"calls={s.get('calls30d')}", flush=True)
            if time.time() + args.interval > deadline:
                break
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
