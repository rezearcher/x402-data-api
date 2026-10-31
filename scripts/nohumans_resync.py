#!/usr/bin/env python3
"""
nohumans_resync.py — keep our nohumans.directory listings' semantic embeddings
fresh, and MEASURE whether we actually surface for the buyer queries we serve.

WHY (the bug this closes): nohumans indexes a listing by embedding its
name + description ONCE, then only re-embeds when the listing is edited
(PATCH). So a listing's indexed vocabulary silently drifts behind our live
catalog — being listed != being discoverable. Two cases proven:
  - MCP listing (177510e0-40c): created with a generic description BEFORE the
    wallet-screen sanctions+scam tool shipped -> invisible for the paying term
    "wallet sanctioned or a scammer" until re-synced (then rank #3).
  - Funding listing (d9a8d4c4-19e): auto-INDEXED, embedded 2026-09-05, name was
    a bare URL and the description listed only 3 of our 5 live venues -> invisible
    for "funding rates data feed" (13 distinct buyer IPs/7d) until claimed +
    re-synced (then rank #2, tied on relevance with the #1 incumbent at 60% our
    price).

WHAT: this is the connected fix. It holds each listing's canonical, buyer-first
copy in version control, PATCHes the live listing to re-trigger the embedding
sync, and then probes /v1/discover for the real buyer terms to record our rank.
A cron (or a post-deploy hook when the catalog grows) re-runs it so the registry
embeddings can never silently drift behind our catalog again.

DATA-DRIVEN: listings live in the LISTINGS table below (id + canonical copy +
buyer queries + optional free sample_query). Add a row to cover a new listing;
no control-flow change. Degrades open: a listing with no reachable edit token
still gets its (read-only) discover measurement — only its PATCH is skipped.

SECRET: edit/claim tokens are NEVER committed. Each is read from
  1) env NOHUMANS_CLAIM_TOKEN (applies to the first listing only), or
  2) ~/.greyridge/resources.json  (local resources registry, outside the repo)
     matched by the listing id appearing in the entry (longest 40-64 hex run).

OUTPUT: ~/.hermes/data/nohumans/discover_rank.json
  { generated_at, listings:[{listing_id, patched, embedding_synced_at,
    queries:[{q,n_results,our_best_rank,our_count}], found_for, total_queries,
    coverage_pct}], coverage_pct, alert }
alert=True when overall coverage < 50% (most buyer terms don't surface us).

Exit code: 0 always (sensor; never blocks a cron).
Usage: python3 -I scripts/nohumans_resync.py [--dry-run] [--no-patch]
"""
import json, os, re, sys, urllib.parse, urllib.request, urllib.error, datetime

API = "https://api.nohumans.directory"
OUT = os.path.expanduser("~/.hermes/data/nohumans/discover_rank.json")

# ---------------------------------------------------------------------------
# Canonical listing copy (source of truth, version-controlled). Each entry is
# superset-/buyer-first: lead with the exact buyer vocabulary we win, then the
# rest of the surface. Claims-Law: a blocklist match, never "safe". `queries`
# are the real demand terms the listing must surface for (semantic probes).
# `sample_query`, when set, must be a FREE GET URL returning 200 + JSON (NOT the
# paid endpoint) — lets agents see representative output before paying.
# ---------------------------------------------------------------------------
LISTINGS = [
    {
        "id": "177510e0-40c",
        "name": "Grey Ridge: wallet sanctions + scam screen, swap-gate & token-safety (MCP)",
        "description": (
            "Is this wallet address sanctioned OR a scammer? Pre-trade counterparty / "
            "recipient / spender screen for any Base or crypto address before an agent "
            "pays, swaps or approves — one call checks BOTH the U.S. Treasury OFAC SDN "
            "sanctions list AND community scam / phishing / wallet-drainer threat-intel "
            "(ScamSniffer + MEW darklist), returning sanctioned + malicious + a "
            "blocked/clear verdict with the list sources and snapshot dates. We match the "
            "FULL 'sanctioned OR scammer' query where sanctions-only screens miss the scam "
            "half. 'clear' = not on these blocklists, not a safety guarantee. The same "
            "keyless remote MCP server also returns a GO/HOLD/BLOCK pre-trade swap gate, "
            "honeypot / token-safety verdicts, DeFi yields, funding rates, prices, "
            "Polymarket and RPC data. Pay-per-call over x402."
        ),
        "sample_query": None,
        "queries": [
            "check if a wallet address is sanctioned or a scammer",
            "is this wallet a scammer or sanctioned before I pay it",
            "screen counterparty wallet for scam and OFAC sanctions",
            "OFAC sanctions check for a crypto wallet address",
            "is this address a known drainer or phishing scam",
        ],
    },
    {
        "id": "d9a8d4c4-19e",
        "name": "Funding rates data feed — 6-venue perp funding + OI-weighted CEX↔DEX arb verdict (thin-book venues excluded)",
        "description": (
            "Funding rates data feed for derivatives / perp trading agents: one keyless "
            "x402 call returns live perpetual funding rates across 6 venues — Binance, "
            "Bybit, OKX, Hyperliquid, dYdX and Gate.io — for the top coins by 24h notional. "
            "The edge over a raw multi-venue feed is CORRECTNESS: the CEX↔DEX arb verdict "
            "(funding spread in bps, cheapest-long / richest-short venue) is computed over an "
            "OPEN-INTEREST-SCREENED venue set, so a near-empty book printing an extreme rate "
            "never inflates the spread or names a venue you can't get size on — you get an "
            "executable verdict, not a thin-book mirage. Per coin you also get each venue's "
            "funding, per-venue open interest in USD, the annualized rate per venue, "
            "premium/basis, mark/oracle prices, next_funding_ts, excluded_thin_venues + an "
            "oi_weighted flag, and a LONGS_PAY / SHORTS_PAY / NEUTRAL directional signal. "
            "$0.004/call — Base-native USDC, no account, no key, pay inline. Free preview "
            "returns representative output before you pay."
        ),
        "sample_query": "https://api.greyridgesignals.ai/crypto/funding/preview",
        "queries": [
            "funding rates data feed",
            "funding rates data feed for derivatives trading",
            "perpetual funding rate across exchanges",
            "cross-venue funding arbitrage signal",
            "open-interest-weighted funding arbitrage",
            "executable funding arb excluding thin books",
            "cheapest venue to go long funding",
        ],
    },
]


def _get_token(listing_id, is_first):
    if is_first:
        t = os.environ.get("NOHUMANS_CLAIM_TOKEN", "").strip()
        if t:
            return t
    res = os.path.expanduser("~/.greyridge/resources.json")
    try:
        with open(res) as f:
            data = json.load(f)
        items = data if isinstance(data, list) else data.get("resources", data.get("items", []))
        for it in items if isinstance(items, list) else []:
            blob = json.dumps(it)
            if listing_id in blob:
                # tokens are a long hex run in the free-text note; pick the longest
                # 40-64 char hex substring (robust to surrounding prose).
                cands = re.findall(r"[0-9a-f]{40,64}", blob)
                if cands:
                    return max(cands, key=len)
    except Exception:
        pass
    return ""


def _req(url, method="GET", body=None, headers=None, timeout=30):
    h = {"Accept": "application/json"}
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode() or "{}")


def patch_listing(listing_id, token, body):
    """PATCH canonical copy to re-trigger embedding sync. Returns (ok, embedding_synced_at)."""
    try:
        st, _ = _req(
            f"{API}/v1/listings/{listing_id}",
            method="PATCH",
            body=body,
            headers={"x-claim-token": token},
        )
        ok = 200 <= st < 300
    except urllib.error.HTTPError as e:
        print(f"[patch {listing_id}] HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        return False, None
    except Exception as e:
        print(f"[patch {listing_id}] error: {e}", file=sys.stderr)
        return False, None
    synced = None
    try:
        _, cur = _req(f"{API}/v1/listings/{listing_id}")
        synced = cur.get("embedding_synced_at")
    except Exception:
        pass
    return ok, synced


def discover_rank(listing_id, q, limit=15):
    url = f"{API}/v1/discover?q={urllib.parse.quote(q)}&limit={limit}"
    try:
        _, d = _req(url)
    except Exception as e:
        return {"q": q, "error": str(e), "n_results": 0, "our_best_rank": None, "our_count": 0}
    results = d.get("results", [])
    best = None
    cnt = 0
    for i, r in enumerate(results):
        if r.get("id") == listing_id:
            cnt += 1
            if best is None:
                best = i + 1
    return {"q": q, "n_results": d.get("count", len(results)), "our_best_rank": best, "our_count": cnt}


def main():
    args = set(sys.argv[1:])
    dry = "--dry-run" in args
    no_patch = "--no-patch" in args or dry

    out_listings = []
    tot_found = 0
    tot_q = 0

    for idx, L in enumerate(LISTINGS):
        lid = L["id"]
        patched = False
        synced = None
        if not no_patch:
            token = _get_token(lid, is_first=(idx == 0))
            if token:
                body = {"name": L["name"], "description": L["description"]}
                if L.get("sample_query"):
                    body["sample_query"] = L["sample_query"]
                patched, synced = patch_listing(lid, token, body)
                print(f"[patch {lid}] ok={patched} embedding_synced_at={synced}")
            else:
                print(f"[patch {lid}] no claim token — skipping PATCH (degrade-open)", file=sys.stderr)
        else:
            print(f"[patch {lid}] skipped (--dry-run/--no-patch)")

        rows = [discover_rank(lid, q) for q in L["queries"]]
        found = sum(1 for r in rows if r.get("our_best_rank"))
        total = len(rows)
        tot_found += found
        tot_q += total
        cov = round(100.0 * found / total, 1) if total else 0.0
        out_listings.append({
            "listing_id": lid,
            "patched": patched,
            "embedding_synced_at": synced,
            "queries": rows,
            "found_for": found,
            "total_queries": total,
            "coverage_pct": cov,
        })

    overall = round(100.0 * tot_found / tot_q, 1) if tot_q else 0.0
    out = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "listings": out_listings,
        "found_for": tot_found,
        "total_queries": tot_q,
        "coverage_pct": overall,
        "alert": overall < 50.0,
    }
    try:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w") as f:
            json.dump(out, f, indent=2)
    except Exception as e:
        print(f"[out] write failed: {e}", file=sys.stderr)

    print(f"\nnohumans discover coverage: {tot_found}/{tot_q} buyer terms surface us ({overall}%)  alert={out['alert']}")
    for L in out_listings:
        print(f"  [{L['listing_id']}] {L['found_for']}/{L['total_queries']} ({L['coverage_pct']}%)")
        for r in L["queries"]:
            rank = r.get("our_best_rank")
            print(f"    [{'#'+str(rank) if rank else '----'}] {r['q']}  (n={r.get('n_results')})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[fatal-degrade-open] {e}", file=sys.stderr)
        sys.exit(0)
