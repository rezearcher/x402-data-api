#!/usr/bin/env python3
"""Keyless Bing-SERP indexation probe for the x402 research/blog pages.

Why this exists: the /research/<slug> pages are our owned buyer-intent content
(the exact phrases a funded agent developer searches the moment they worry about
paying an endpoint). Until commit 79d9854 they were orphaned -- absent from
sitemap.xml and unlinked from any crawled page -- so search engines left them
"Discovered - currently not indexed" for ~2 weeks despite IndexNow pings. That
fix added them to the sitemap, linked /research from the homepage (+/terms), and
re-submitted all 197 URLs to IndexNow.

This probe makes that fix FALSIFIABLE: it asks Bing (the retrieval set behind
Copilot / ChatGPT Search) whether our host now surfaces for the literal
high-intent queries those pages target. Baseline is expected to be 0 (absent);
if the de-orphaning works, a research page enters Bing's index and serp_hits
rises. Same pattern as the proven HESI/ClaimFinder/TEAS bing_presence sensors:
keyless, degrades OPEN (a probe failure returns None/unknown, never a false 0).

Usage: python3 -I scripts/seo_indexation_sensor.py [--print]
Writes ~/.hermes/data/x402-seo/latest.json
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# Canonical SEO origin (src/index.ts CANONICAL_ORIGIN): sitemap <loc>, canonical
# and og:url all resolve here, so this is the host Bing would index our pages under.
HOST = "api.greyridgesignals.ai"
# workers.dev is the live transaction host; pages self-canonical to HOST, but Bing
# may index either, so a hit on either counts as "our content surfaced".
ALT_HOST = "x402-data-api.sigrunner.workers.dev"

# Literal buyer-intent queries, each mapping to a live /research page title. These
# are the phrases an about-to-pay agent developer types -- not our brand name.
BING_QUERIES = [
    "is this x402 endpoint safe to pay before my agent calls it",
    "screen a wallet for OFAC sanctions before your agent trades",
    "verify x402 payment settled onchain receipt proof",
    "check erc20 allowance before your agent spends",
    "x402 settlement attestation an auditor can recompute",
]

_BING_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")


def iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bing_presence(queries=None, timeout=20, fetch=None):
    """Keyless Bing-index probe. `fetch(query)->html` injectable for tests.

    Returns: indexed True/False/None (None=unknown, degrade open), serp_hits int,
    and the per-query detail so a human/judge can see which phrase surfaced.
    """
    queries = queries or BING_QUERIES

    def _default_fetch(q):
        url = "https://www.bing.com/search?q=" + urllib.parse.quote(q)
        req = urllib.request.Request(
            url, headers={"user-agent": _BING_UA, "accept-language": "en-US,en;q=0.9"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")

    fetch = fetch or _default_fetch
    probed, errors = [], []
    for q in queries:
        try:
            html = fetch(q)
        except Exception as e:  # noqa: BLE001 -- any failure => unknown for this query
            errors.append(f"{q[:40]}: {str(e)[:60]}")
            continue
        found = (HOST in html) or (ALT_HOST in html)
        probed.append(dict(query=q, found=found))
    if not probed:  # every query errored -> unknown, never a false 0
        return dict(indexed=None, serp_hits=0, host=HOST, queries=[],
                    detail="probe failed (unknown): " + "; ".join(errors), probed_at=iso())
    hits = sum(1 for p in probed if p["found"])
    return dict(
        indexed=hits > 0,
        serp_hits=hits,
        host=HOST,
        alt_host=ALT_HOST,
        queries=probed,
        errors=errors or None,
        detail=("a Grey Ridge host surfaced in Bing SERP (Copilot/ChatGPT Search can retrieve it)"
                if hits else "absent from Bing index -> AI retrieval set is empty for these queries"),
        probed_at=iso(),
    )


def main():
    res = bing_presence()
    out = {
        "fetched_at": iso(),
        "sensor": "x402-seo-indexation",
        "research_indexation": res,
        # headline field the ledger reads:
        "serp_hits": res.get("serp_hits", 0),
    }
    data_dir = os.path.expanduser("~/.hermes/data/x402-seo")
    os.makedirs(data_dir, exist_ok=True)
    path = os.path.join(data_dir, "latest.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=2)
    if "--print" in sys.argv:
        print(json.dumps(out, indent=2))
    else:
        r = out["research_indexation"]
        print(f"x402 SEO indexation: indexed={r.get('indexed')} serp_hits={r.get('serp_hits')} "
              f"-> {path}")


if __name__ == "__main__":
    main()
