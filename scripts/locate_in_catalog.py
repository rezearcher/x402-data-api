#!/usr/bin/env python3
"""Locate our routes' absolute index in the deterministic /discovery/resources crawl.

Why this exists: /discovery/resources is a fixed-order paginated enumeration
(90,328 items, 20 per page, 4,516 pages). Presence/absence in "the first N
items" is a position artifact, not a delisting signal -- so the only honest
way to compare before vs after a settlement is the *absolute index* of a
record in the SAME ordering. The crawl order is verified stable across days:
page 1 begins with the same record on 2026-10-20 and 2026-10-28.

Usage:
  python3 scripts/locate_in_catalog.py --offset-start 12600 --offset-end 13000
  python3 scripts/locate_in_catalog.py --coarse --step 400
"""
import argparse
import json
import sys
import time
import urllib.request

BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources"
OURS = "sigrunner"


def fetch_page(offset, limit=20, timeout=30, retries=3):
    url = f"{BASE}?limit={limit}&offset={offset}"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - network flake is expected
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"offset {offset} failed: {last}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offset-start", type=int, default=0)
    ap.add_argument("--offset-end", type=int, default=2000)
    ap.add_argument("--coarse", action="store_true", help="sample every --step offsets")
    ap.add_argument("--step", type=int, default=20)
    ap.add_argument("--out", default="/tmp/catalog_locate.json")
    args = ap.parse_args()

    step = args.step if args.coarse else 20
    hits = []
    pages = 0
    total = None
    offsets = list(range(args.offset_start, args.offset_end + 1, step))
    for off in offsets:
        d = fetch_page(off)
        pages += 1
        total = d.get("pagination", {}).get("total", total)
        for i, r in enumerate(d.get("items", [])):
            url = r.get("resource") or ""
            if OURS in url:
                hits.append(
                    {
                        "index": off + i,
                        "resource": url,
                        "serviceName": r.get("serviceName"),
                        "lastUpdated": r.get("lastUpdated"),
                        "quality": r.get("quality"),
                    }
                )
        if pages % 10 == 0:
            print(f"  ...{pages}/{len(offsets)} pages (offset {off})", file=sys.stderr)
        time.sleep(0.08)

    out = {
        "endpoint": BASE,
        "catalog_total": total,
        "offsets_scanned": [args.offset_start, args.offset_end, step],
        "pages_fetched": pages,
        "hits": hits,
        "hits_count": len(hits),
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
