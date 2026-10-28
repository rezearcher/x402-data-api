#!/usr/bin/env python3
"""Rate-limit-aware head scan of /discovery/resources.

Hypothesis under test: the catalog is enumerated in `lastUpdated` DESCENDING
order, so a settlement that rewrites `lastUpdated` moves a record toward
index 0 of the crawl (and back into the windows any bounded crawler reads).
This scan measures where our routes sit in that ordering right now.

Politeness: 1 req/0.6s, exponential backoff on 429, resumable via checkpoint
so a throttled run can be continued instead of restarted.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources"
CKPT = "/tmp/head_scan_ckpt.json"


def fetch(offset, retries=6):
    url = f"{BASE}?limit=20&offset={offset}"
    delay = 3.0
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  429 at offset {offset}; sleeping {delay:.0f}s", file=sys.stderr)
                time.sleep(delay)
                delay = min(delay * 1.8, 45)
                continue
            raise
        except Exception:  # noqa: BLE001
            time.sleep(delay / 2)
    raise RuntimeError(f"gave up at offset {offset}")


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 700
    rows, hits = [], []
    if os.path.exists(CKPT) and start == 0:
        try:
            prev = json.load(open(CKPT))
            rows, hits = prev["rows"], prev["hits"]
            print(f"resumed with {len(rows)} rows", file=sys.stderr)
        except Exception:  # noqa: BLE001
            pass
    for off in range(start, end, 20):
        d = fetch(off)
        for i, r in enumerate(d.get("items", [])):
            u = r.get("resource") or ""
            rows.append([off + i, r.get("lastUpdated"), u])
            if "sigrunner" in u:
                hits.append([off + i, u, r.get("lastUpdated"), r.get("quality")])
                print(f"  HIT idx {off+i} {u[-45:]} {r.get('lastUpdated')}", file=sys.stderr)
        json.dump({"rows": rows, "hits": hits}, open(CKPT, "w"))
        time.sleep(0.6)

    breaks = sum(1 for a, b in zip(rows[1:], rows[2:]) if a[1] and b[1] and a[1] < b[1])
    out = {
        "scanned_items": len(rows),
        "offset_range": [start, end],
        "order_by_lastUpdated_desc": breaks == 0,
        "ordering_breaks": breaks,
        "hits": hits,
        "hits_count": len(hits),
        "first_5": rows[:5],
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    print(json.dumps(out, indent=2))
    json.dump(out, open("/tmp/head_scan_result.json", "w"), indent=2)


if __name__ == "__main__":
    main()
