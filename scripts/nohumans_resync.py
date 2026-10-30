#!/usr/bin/env python3
"""
nohumans_resync.py — keep our nohumans.directory listing's semantic embedding
fresh, and MEASURE whether we actually surface for the buyer queries we serve.

WHY (the bug this closes): nohumans indexes a listing by embedding its
name + description ONCE, then only re-embeds when the listing is edited
(PATCH). Our MCP listing (id 177510e0-40c) was created 2026-10-28 with a
generic "swap gate + yields + funding" description, BEFORE the
/chain/wallet-screen sanctions+scam tool shipped. So for the live, paying
buyer term "check if a wallet address is sanctioned or a scammer" (9 distinct
buyer IPs/window) our listing returned ZERO — not because we lack the product
(we ship the only OFAC-sanctions-OR-scammer superset) but because the indexed
vocabulary was stale. Being listed != being discoverable.

WHAT: this script is the connected fix. It holds the canonical, superset-first
listing copy in version control, PATCHes the live listing to re-trigger the
embedding sync, and then probes /v1/discover for the real buyer terms to record
our rank. A cron (or a post-deploy hook when the catalog grows) re-runs it so
the registry embedding can never silently drift behind our catalog again.

SECRET: the listing claim token is NEVER committed. It is read from
  1) env NOHUMANS_CLAIM_TOKEN, or
  2) ~/.greyridge/resources.json  (local resources registry, outside the repo)
If neither is present, the script still runs the (read-only) discover
measurement and just skips the PATCH.

OUTPUT: ~/.hermes/data/nohumans/discover_rank.json
  { generated_at, listing_id, patched(bool), embedding_synced_at,
    queries:[{q, n_results, our_best_rank|null, our_count}],
    found_for, total_queries, coverage_pct, alert }
alert=True when coverage < 50% (most buyer terms don't surface us in the window).

Exit code: 0 always (sensor; never blocks a cron).
Usage: python3 -I scripts/nohumans_resync.py [--dry-run] [--no-patch]
"""
import json, os, re, sys, urllib.parse, urllib.request, urllib.error, datetime

LISTING_ID = "177510e0-40c"
API = "https://api.nohumans.directory"
OUT = os.path.expanduser("~/.hermes/data/nohumans/discover_rank.json")

# Canonical listing copy (source of truth, version-controlled). Superset-first:
# lead with the exact buyer vocabulary for the term we uniquely win, then the
# rest of the MCP surface. Claims-Law: a blocklist match, never "safe".
CANON_NAME = "Grey Ridge: wallet sanctions + scam screen, swap-gate & token-safety (MCP)"
CANON_DESC = (
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
)

# The real buyer terms this listing is meant to serve (semantic probes).
BUYER_QUERIES = [
    "check if a wallet address is sanctioned or a scammer",
    "is this wallet a scammer or sanctioned before I pay it",
    "screen counterparty wallet for scam and OFAC sanctions",
    "OFAC sanctions check for a crypto wallet address",
    "is this address a known drainer or phishing scam",
]


def _get_token():
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
            if LISTING_ID in blob:
                # claim tokens are a long hex run in the free-text note; pick the
                # longest 40-64 char hex substring (robust to surrounding prose).
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


def patch_listing(token):
    """PATCH name+desc to re-trigger embedding sync. Returns (ok, embedding_synced_at)."""
    try:
        st, _ = _req(
            f"{API}/v1/listings/{LISTING_ID}",
            method="PATCH",
            body={"name": CANON_NAME, "description": CANON_DESC},
            headers={"x-claim-token": token},
        )
        ok = 200 <= st < 300
    except urllib.error.HTTPError as e:
        print(f"[patch] HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        return False, None
    except Exception as e:
        print(f"[patch] error: {e}", file=sys.stderr)
        return False, None
    # read back the sync timestamp (proof the embedding refreshed)
    synced = None
    try:
        _, cur = _req(f"{API}/v1/listings/{LISTING_ID}")
        synced = cur.get("embedding_synced_at")
    except Exception:
        pass
    return ok, synced


def discover_rank(q, limit=15):
    url = f"{API}/v1/discover?q={urllib.parse.quote(q)}&limit={limit}"
    try:
        _, d = _req(url)
    except Exception as e:
        return {"q": q, "error": str(e), "n_results": 0, "our_best_rank": None, "our_count": 0}
    results = d.get("results", [])
    best = None
    cnt = 0
    for i, r in enumerate(results):
        if r.get("id") == LISTING_ID:
            cnt += 1
            if best is None:
                best = i + 1
    return {"q": q, "n_results": d.get("count", len(results)), "our_best_rank": best, "our_count": cnt}


def main():
    args = set(sys.argv[1:])
    dry = "--dry-run" in args
    no_patch = "--no-patch" in args or dry

    patched = False
    synced = None
    if not no_patch:
        token = _get_token()
        if token:
            patched, synced = patch_listing(token)
            print(f"[patch] ok={patched} embedding_synced_at={synced}")
        else:
            print("[patch] no claim token (env NOHUMANS_CLAIM_TOKEN or resources.json) — skipping PATCH", file=sys.stderr)
    else:
        print("[patch] skipped (--dry-run/--no-patch)")

    rows = [discover_rank(q) for q in BUYER_QUERIES]
    found = sum(1 for r in rows if r.get("our_best_rank"))
    total = len(rows)
    cov = round(100.0 * found / total, 1) if total else 0.0
    out = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "listing_id": LISTING_ID,
        "patched": patched,
        "embedding_synced_at": synced,
        "queries": rows,
        "found_for": found,
        "total_queries": total,
        "coverage_pct": cov,
        "alert": cov < 50.0,
    }
    try:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w") as f:
            json.dump(out, f, indent=2)
    except Exception as e:
        print(f"[out] write failed: {e}", file=sys.stderr)

    print(f"\nnohumans discover coverage: {found}/{total} buyer terms surface us ({cov}%)  alert={out['alert']}")
    for r in rows:
        rank = r.get("our_best_rank")
        print(f"  [{'#'+str(rank) if rank else '----'}] {r['q']}  (n={r.get('n_results')})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"[fatal-degrade-open] {e}", file=sys.stderr)
        sys.exit(0)
