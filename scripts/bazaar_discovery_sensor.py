#!/usr/bin/env python3
"""
bazaar_discovery_sensor.py — Does an agent-buyer searching the CDP x402 Bazaar
for our categories actually FIND us, and at what rank?

WHY: Being indexed is not the same as being discoverable. CDP discovery is a
semantic (embedding) search over each resource's registered description /
serviceName / tags. If our flagship routes don't rank in the top results for the
natural buyer queries ("token safety", "is this token a scam", "rug pull check"),
an agent-buyer never finds us even though we are in the catalog. This sensor
measures that gap every run so a future cycle can see whether discoverability
work (desc/tags tuning, re-index) is actually moving rank.

MEASURE: for each canonical buyer query, query the live CDP discovery/search
endpoint (limit 20) and record the best (lowest) rank at which any Grey Ridge
route appears, plus which route. 0 self-pay, read-only.

OUTPUT: ~/.hermes/data/x402_bazaar_index/discovery_rank.json
  { generated_at, queries:[{q, n_results, our_best_rank|null, our_route|null, our_count}],
    found_for, total_queries, coverage_pct, alert }
alert=True when coverage < 50% (most buyer queries don't surface us in top-20).

Exit code: 0 always (sensor; never blocks a cron).
Usage: python3 -I scripts/bazaar_discovery_sensor.py [extra query ...]
"""
import json, os, sys, time, urllib.parse, urllib.request, datetime

# Canonical queries an agent-buyer would actually type for our product surface,
# each tagged with the market CATEGORY it probes. The category tag lets us derive
# which rival domains are AGGREGATORS/PLATFORMS (surface across >=2 unrelated
# categories = they bundle many data types; a distribution surface, not a single
# competing API) vs single-API competitors -- a measured structural signal, no
# hardcoded roster.
QUERY_CATS = [
    ("token safety check before swap", "token-safety"),
    ("is this token a scam", "token-safety"),
    ("rug pull check base token", "token-safety"),
    ("honeypot detector base erc20", "token-safety"),
    ("token risk report", "token-safety"),
    ("pre-trade safety gate", "token-safety"),
    ("gas price base", "gas"),
    ("crypto funding rates", "funding"),
    ("defi yields", "yields"),
    ("prediction market odds", "prediction"),
]
# extra CLI queries get a generic category so they don't skew aggregator derivation
QUERY_CATS += [(q, "adhoc") for q in sys.argv[1:]]
QUERIES = [q for q, _ in QUERY_CATS]

OUT_DIR = os.path.join(os.path.expanduser("~"), ".hermes", "data", "x402_bazaar_index")
OUT = os.path.join(OUT_DIR, "discovery_rank.json")
BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search"
OURS = ("sigrunner", "greyridge")


def _is_ours(r):
    blob = (str(r.get("resource") or "") + " " + str(r.get("url") or "") + " " +
            str(r.get("description") or "") + " " + json.dumps(r.get("accepts") or [])).lower()
    # our receiving wallet is the unambiguous fingerprint
    if "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10" in blob:
        return True
    return any(o in blob for o in OURS)


def _route_of(r):
    res = r.get("resource")
    if isinstance(res, str):
        return res[-45:]
    return (r.get("url") or r.get("description") or "")[:45]


def _url_of(r):
    res = r.get("resource")
    if isinstance(res, str):
        return res
    if isinstance(res, dict):
        return res.get("url") or ""
    return r.get("url") or ""


def _domain(url):
    try:
        net = urllib.parse.urlparse(url).netloc.lower()
        return net or None
    except Exception:
        return None


def probe(q):
    u = BASE + "?" + urllib.parse.urlencode({"query": q, "limit": 20})
    req = urllib.request.Request(u, headers={"user-agent": "Mozilla/5.0 (greyridge-discovery-sensor)"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=25))
    except Exception as e:
        return {"q": q, "error": f"{type(e).__name__}: {e}", "n_results": 0,
                "our_best_rank": None, "our_route": None, "our_count": 0, "top3": []}
    rs = d.get("resources") or d.get("items") or []
    ranks = [(i + 1, _route_of(r)) for i, r in enumerate(rs) if _is_ours(r)]
    best = ranks[0] if ranks else (None, None)
    # capture the live competitor set (top-3 rivals that aren't us) — proof the
    # demand is real and a map of who is currently capturing our market.
    top3 = []
    for r in rs:
        if _is_ours(r):
            continue
        dom = _domain(_url_of(r))
        if dom:
            top3.append(dom)
        if len(top3) >= 3:
            break
    return {"q": q, "n_results": len(rs), "our_best_rank": best[0],
            "our_route": best[1], "our_count": len(ranks), "top3": top3}


def metadata_health():
    """Measure whether CDP actually reflects our CURRENT catalog metadata, or a
    frozen first-registration snapshot. PROVEN 2026-10-21 (cycle ap+): CDP freezes
    serviceName/description at first registration — a settlement only bumps
    quality.lastCalledAt, it does NOT overwrite serviceName/desc. Confirmed: the
    canary refresh ran 12.8h earlier sending the correct serviceName
    ('Base Token Safety & Honeypot Scanner') + buyer-language desc, yet CDP still
    returns serviceName=null + the old jargon desc for 19/20 routes (only
    /defi/yields ever captured a serviceName, and a STALE one: 'Grey Ridge Signals').
    Because production revenue settles via xpay (never the CDP facilitator), the
    ONLY settlements that touch CDP's catalog are our own canary self-pays — which
    are forbidden (self-dealing, scoreboard pollution). => CDP need-phrase rank is
    NOT a legitimately movable lever for us; low coverage is a STRUCTURAL state,
    not an actionable regression. Returns (named, total, frozen:bool)."""
    try:
        u = BASE + "?" + urllib.parse.urlencode({"query": "sigrunner", "limit": 20})
        req = urllib.request.Request(u, headers={"user-agent": "Mozilla/5.0 (greyridge-discovery-sensor)"})
        d = json.load(urllib.request.urlopen(req, timeout=25))
        rs = [r for r in (d.get("resources") or d.get("items") or []) if _is_ours(r)]
        named = sum(1 for r in rs if (r.get("serviceName") or (r.get("info") or {}).get("serviceName")))
        total = len(rs)
        # frozen when the vast majority of indexed routes still lack the serviceName
        # the catalog refresh has been sending for weeks (>=70% null = pinned-stale)
        frozen = total > 0 and named <= 0.3 * total
        return named, total, frozen
    except Exception:
        return None, None, None


def main():
    results = []
    cat_by_q = dict(QUERY_CATS)
    # domain -> set of distinct market categories it ranks top-3 in
    dom_cats = {}
    dom_hits = {}
    for q in QUERIES:
        res = probe(q)
        results.append(res)
        cat = cat_by_q.get(q, "adhoc")
        for dom in res.get("top3", []):
            dom_cats.setdefault(dom, set()).add(cat)
            dom_hits[dom] = dom_hits.get(dom, 0) + 1
        time.sleep(0.4)
    found = sum(1 for r in results if r.get("our_best_rank"))
    total = len(results)
    cov = round(100.0 * found / total, 1) if total else 0.0
    # DERIVE distribution candidates: a domain ranking top-3 across >=2 DISTINCT
    # market categories is structurally an aggregator/platform (it bundles many
    # data types), i.e. a surface we could be listed ON — not a single-API rival.
    # Pure measured signal from the live index; no hardcoded roster.
    distribution_candidates = sorted(
        ({"domain": d, "categories": sorted(c), "top3_hits": dom_hits.get(d, 0)}
         for d, c in dom_cats.items() if len(c) >= 2),
        key=lambda x: (-len(x["categories"]), -x["top3_hits"], x["domain"]),
    )
    named, named_total, frozen = metadata_health()
    # STRUCTURAL FINDING (cycle ap+, 2026-10-21): low CDP coverage is NOT an
    # actionable regression when our metadata is frozen stale — CDP pins
    # serviceName/desc at first registration and only self-pay settlements (which
    # are forbidden) touch its catalog. So we only ALERT on low coverage if the
    # metadata is NOT frozen (i.e. coverage dropped for a reason we could actually
    # fix). When frozen, we record the dead-lever conclusion and do NOT cry wolf.
    structural_block = None
    if frozen:
        structural_block = (
            "CDP metadata frozen at first-registration: %s/%s indexed routes carry "
            "a serviceName despite the catalog refresh sending it for weeks. CDP "
            "settlements only bump quality.lastCalledAt; serviceName/desc are not "
            "overwritten. Production revenue settles via xpay (never CDP facilitator), "
            "so the only catalog-touching settlements are forbidden self-pays. => CDP "
            "need-phrase rank is NOT a legitimately movable lever; pursue direct dev "
            "integrations (wire-our-URL PRs) + x402scan browse instead." % (named, named_total)
        )
    payload = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "endpoint": BASE,
        "total_queries": total,
        "found_for": found,
        "coverage_pct": cov,
        "metadata_named_routes": named,
        "metadata_total_routes": named_total,
        "metadata_frozen": frozen,
        "structural_block": structural_block,
        # alert only on a FIXABLE coverage gap, never on the proven dead lever
        "alert": cov < 50.0 and not frozen,
        "distribution_candidates": distribution_candidates,
        "queries": results,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"bazaar discovery coverage: {found}/{total} queries surface us ({cov}%)"
          + ("  [ALERT: most buyer queries don't find us]" if payload["alert"] else ""))
    if structural_block:
        print(f"  [STRUCTURAL / dead lever — not an actionable alert] {structural_block}")
    for r in results:
        rk = r.get("our_best_rank")
        tag = f"rank {rk} {r.get('our_route')}" if rk else ("ERR " + r["error"] if r.get("error") else "NOT in top-20")
        comp = (" | top3: " + ", ".join(r.get("top3", []))) if r.get("top3") else ""
        print(f"  {r['q']!r:40s} n={r['n_results']:2d}  {tag}{comp}")
    if distribution_candidates:
        print("DERIVED distribution candidates (rank top-3 across >=2 categories = aggregator/platform surface):")
        for c in distribution_candidates:
            print(f"  {c['domain']:40s} categories={c['categories']} hits={c['top3_hits']}")
    else:
        print("DERIVED distribution candidates: none (no rival domain spans >=2 categories)")
    print(f"written -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
