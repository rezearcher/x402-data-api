#!/usr/bin/env python3
"""Submit the live Worker domain's pages to IndexNow (Bing/Yandex -> Copilot/ChatGPT/Perplexity).

Why this exists: gen_mcp_scorecards.py pings IndexNow only for the github.io
scorecard pages. The Worker domain (x402-data-api.sigrunner.workers.dev) hosts
the human-facing conversion surfaces -- /miniapp (free Base honeypot checker with
a paid upgrade), /pricing (fiat checkout), /scan/mcp-scanner, /learn/*, /scan/* --
and Googlebot is not crawling workers.dev, so those pages had no active engine
submission at all. IndexNow is a free push that reaches the answer engines retail
traders increasingly ask ("is <token> a honeypot"). The key-file is already served
by the Worker at /<key>.txt (src/index.ts), so submission is authorised.

The URL list is derived from the live sitemap.xml (ground truth) -- never a
hardcoded list -- so new pages are picked up automatically on the next run.

Usage: python3 scripts/submit_worker_indexnow.py [--dry-run]
"""
import json
import os
import sys
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

HOST = "x402-data-api.sigrunner.workers.dev"
SITEMAP = f"https://{HOST}/sitemap.xml"
INDEXNOW_ENDPOINT = "https://api.indexnow.org/IndexNow"


def _load_key():
    here = os.path.dirname(__file__)
    for p in ("outreach/indexnow.key", os.path.join(here, "..", "outreach", "indexnow.key")):
        try:
            with open(p) as f:
                k = f.read().strip()
                if k:
                    return k
        except OSError:
            continue
    raise SystemExit("IndexNow key not found at outreach/indexnow.key")


def _fetch_sitemap_urls():
    req = urllib.request.Request(SITEMAP, headers={"User-Agent": "greyridge-indexnow/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        xml = r.read().decode()
    root = ET.fromstring(xml)
    # sitemap namespace-agnostic: match any element whose tag ends in 'loc'
    urls = [e.text.strip() for e in root.iter() if e.tag.endswith("loc") and e.text]
    return urls


def submit(urls, key, dry=False):
    key_location = f"https://{HOST}/{key}.txt"
    body = json.dumps({
        "host": HOST,
        "key": key,
        "keyLocation": key_location,
        "urlList": urls,
    }).encode()
    if dry:
        print(f"[dry-run] would POST {len(urls)} URLs to IndexNow (keyLocation={key_location})")
        for u in urls:
            print("  ", u)
        return 0
    req = urllib.request.Request(
        INDEXNOW_ENDPOINT, data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"IndexNow: submitted {len(urls)} URLs -> HTTP {r.status}")
            return 0 if r.status in (200, 202) else 1
    except urllib.error.HTTPError as e:
        # 200/202 = accepted; 422 = some URLs rejected (still useful signal)
        print(f"IndexNow: HTTP {e.code} {e.reason}")
        return 0 if e.code in (200, 202) else 2


def main():
    dry = "--dry-run" in sys.argv
    key = _load_key()
    urls = _fetch_sitemap_urls()
    if not urls:
        raise SystemExit("no URLs in sitemap")
    print(f"sitemap -> {len(urls)} URLs on {HOST}")
    return submit(urls, key, dry=dry)


if __name__ == "__main__":
    sys.exit(main())
