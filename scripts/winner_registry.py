#!/usr/bin/env python3
"""winner_registry.py — persistent registry of who makes money on x402, and HOW.

The money loop used to re-derive its competitor set every cycle. This keeps one
live, queryable view (the Scout's data substrate): per competitor the lane, price,
chains, free-vs-paid, distribution channel, differentiator, weakness, revenue
estimate, and the evidence behind each claim. Upsert by `id`; partial records are
fine (missing fields default to ""/null).

Store: ~/.hermes/data/x402_margin/winners.jsonl (override: WINNER_STORE env or
--store). Atomic writes (tmp + os.replace); a missing/corrupt store reads as empty.

Usage: python3 -I scripts/winner_registry.py {seed|add|upsert '<json>'|list|get <id>|
       render|stats|selftest} [--store PATH] [--refresh-landscape]
"""
import argparse
import collections
import datetime
import json
import os
import re
import sys
import tempfile
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PAYTO = os.path.join(HERE, "competitor_payto.json")
LANDSCAPE = os.path.expanduser("~/.hermes/data/x402_landscape/latest.json")
DEFAULT_STORE = os.path.expanduser("~/.hermes/data/x402_margin/winners.jsonl")
STALE_DAYS = 30

FIELDS = ["id", "name", "url", "lane", "price", "chains", "free_or_paid",
          "distribution_channel", "differentiator", "their_weakness",
          "monthly_revenue_est", "evidence_source", "last_verified", "notes"]

# URL-path keyword -> lane. Config/data: an unmatched path degrades to "other".
LANE_HINTS = [
    (r"token|rug|honeypot|scam|liquidity|due-diligence", "token-safety"),
    (r"security|audit|contract", "contract-security"),
    (r"drug|medical|fda|trial|rx|bio|chem|mesh", "medical-data"),
    (r"price|market|swap|defi|signal|wallet|onchain", "crypto-data"),
    (r"enrich|email|company|people", "enrichment"),
    (r"llm|chat|infer|completion", "inference"),
]


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def norm(rec):
    out = {k: rec.get(k, "") for k in FIELDS}
    if out["monthly_revenue_est"] == "":
        out["monthly_revenue_est"] = None
    if not out["id"]:
        out["id"] = slug(out["name"] or out["url"])
    return out


def load(path):
    recs = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    r = json.loads(line)
                    if isinstance(r, dict) and r.get("id"):
                        recs[r["id"]] = norm(r)
                except ValueError:
                    continue
    except OSError:
        pass
    return recs


def save(path, recs):
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".winners.", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        for r in recs.values():
            f.write(json.dumps(r, sort_keys=True) + "\n")
    os.replace(tmp, path)


def upsert(recs, rec):
    """Merge rec over any existing record; empty incoming fields never erase data."""
    new = norm(rec)
    old = recs.get(new["id"])
    if old:
        for k in FIELDS:
            if new[k] in ("", None):
                new[k] = old[k]
    recs[new["id"]] = new
    return new


def infer_lane(url):
    path = urlparse(url).path.lower()
    for pat, lane in LANE_HINTS:
        if re.search(pat, path):
            return lane
    return "other"


def known_records():
    v = now()
    k = lambda **kw: dict(kw, last_verified=v, evidence_source=kw.pop("ev", "our research"))
    return [
        k(id="goplus", name="GoPlus", url="https://gopluslabs.io", lane="token-safety",
          price="free", chains="multi-chain", free_or_paid="free",
          distribution_channel="incumbent API, 30+ categories",
          differentiator="breadth: 30+ security categories across many chains",
          their_weakness="not agent-native; no decision layer"),
        k(id="blue-agent", name="blue-agent", url="https://blueagent.dev", lane="token-safety",
          price="free", chains="Base, Robinhood", free_or_paid="free",
          differentiator="free keyless x402", their_weakness="free, so no margin"),
        k(id="true402", name="true402", lane="token-safety", price="~$0.01", free_or_paid="paid",
          distribution_channel="framework wrappers ElizaOS/CrewAI/GAME/Vercel/npx",
          their_weakness="thin paid lane"),
        k(id="blockrun", name="BlockRun.ai", url="https://blockrun.ai", lane="inference",
          price="$0.002", free_or_paid="paid",
          distribution_channel="owns ClawRouter free installed router, keeps spread",
          differentiator="free hook + paid x402 backend",
          their_weakness="generic inference commoditizing", monthly_revenue_est=2680,
          notes="landscape: $2680/mo, 85K tx"),
        k(id="stableenrich", name="StableEnrich", lane="enrichment", price="$0.01",
          free_or_paid="paid", monthly_revenue_est=3120,
          differentiator="aggregates Apollo/Exa/Firecrawl/Serper into one SKU",
          notes="landscape: $3120/mo, 108K tx"),
        k(id="agentlisa", name="AgentLisa", lane="contract-security", free_or_paid="paid",
          distribution_channel="launched to dev audience",
          notes="landscape: ~$3100/day launch spike; not a steady monthly figure"),
        k(id="atxp", name="ATXP", lane="agent-payment-infra", free_or_paid="paid",
          monthly_revenue_est=56000, notes="landscape: ~$56K/30d; infra, not a data benchmark"),
    ]


def seed(recs):
    added = 0

    def add(rec):
        nonlocal added
        if norm(rec)["id"] not in recs:
            upsert(recs, rec)
            added += 1

    for rec in known_records():
        add(rec)
    try:
        with open(PAYTO) as f:
            rows = json.load(f)
    except (OSError, ValueError):
        rows = []
    hosts = collections.OrderedDict()
    for row in rows:
        try:
            addr, url, price = row[0], row[1], row[2]
        except (IndexError, TypeError):
            continue
        h = urlparse(url).netloc
        if h:
            hosts.setdefault(h, (addr, url, price))
    for h, (addr, url, price) in hosts.items():
        units = "" if price in (None, "") else "$%g" % (int(price) / 1e6)
        add(dict(id=slug(h), name=h, url=url, lane=infer_lane(url), price=units,
                 chains="base", free_or_paid="paid", evidence_source="on-chain payTo",
                 notes="payTo " + addr, last_verified=now()))
    try:
        with open(LANDSCAPE) as f:
            top = json.load(f).get("top_earners") or []
    except (OSError, ValueError):
        top = []
    for e in top:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        s = slug(e["name"])
        if any(s == i or s.startswith(i + "-") for i in recs):
            continue
        add(dict(id=s, name=e["name"], lane=e.get("category", ""), free_or_paid="paid",
                 evidence_source="x402_landscape top_earners", last_verified=now(),
                 differentiator=e.get("sells", ""),
                 notes="%s | %s" % (e.get("revenue", ""), e.get("clean", ""))))
    return added


def refresh_landscape():
    try:
        with open(LANDSCAPE) as f:
            fa = json.load(f).get("fetched_at")
        t = datetime.datetime.fromisoformat(fa.replace("Z", "+00:00"))
        age = (datetime.datetime.now(datetime.timezone.utc) - t).days
    except Exception as e:
        print("STALE: landscape unreadable (%s); re-run the landscape pass" % e)
        return
    if age > STALE_DAYS:
        print("STALE: x402 landscape is %dd old (fetched_at=%s, limit %dd). "
              "Re-run the landscape pass to refresh top_earners; registry numbers "
              "are NOT updated." % (age, fa, STALE_DAYS))
    else:
        print("landscape fresh: %dd old (fetched_at=%s)" % (age, fa))


def render(recs):
    rows = sorted(recs.values(), key=lambda r: (r["monthly_revenue_est"] is None,
                                                -(r["monthly_revenue_est"] or 0), r["name"]))
    print("%-24s %-18s %-8s %-9s %-6s %s" % ("NAME", "LANE", "PRICE", "REV/MO", "F/P", "DISTRIBUTION"))
    for r in rows:
        rev = "" if r["monthly_revenue_est"] is None else "$%g" % r["monthly_revenue_est"]
        print("%-24s %-18s %-8s %-9s %-6s %s" % (str(r["name"])[:24], str(r["lane"])[:18],
              str(r["price"])[:8], rev, str(r["free_or_paid"])[:6],
              str(r["distribution_channel"])[:50]))
    print("total: %d" % len(rows))


def stats(recs):
    for field in ("lane", "free_or_paid", "distribution_channel"):
        c = collections.Counter(r[field] or "(unset)" for r in recs.values())
        print("by %s:" % field)
        for k, n in c.most_common():
            print("  %4d  %s" % (n, k))
    print("total: %d" % len(recs))


def selftest():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "winners.jsonl")
        recs = load(p)
        assert recs == {}, "missing store must read empty"
        n = seed(recs)
        assert n == len(recs) and n >= 7, "seed count %d" % n
        assert seed(recs) == 0, "seed must be idempotent"
        save(p, recs)
        recs = load(p)
        assert "goplus" in recs and "stableenrich" in recs, "seed ids missing"
        before = len(recs)
        upsert(recs, {"id": "zz-test", "name": "ZZ"})
        assert len(recs) == before + 1 and recs["zz-test"]["price"] == "", "partial upsert"
        upsert(recs, {"id": "zz-test", "price": "$1"})
        assert len(recs) == before + 1, "dedup by id failed"
        assert recs["zz-test"]["name"] == "ZZ" and recs["zz-test"]["price"] == "$1", "merge"
        save(p, recs)
        assert len(load(p)) == before + 1, "roundtrip"
        with open(p, "a") as f:
            f.write("{corrupt\n")
        assert len(load(p)) == before + 1, "corrupt line must be skipped"
        assert load(os.path.join(d, "nope", "x")) == {}, "degrade-open"
    print("SELFTEST OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", nargs="?", default="list",
                    choices=["seed", "add", "upsert", "list", "get", "render", "stats", "selftest"])
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--store", default=os.environ.get("WINNER_STORE", DEFAULT_STORE))
    ap.add_argument("--refresh-landscape", action="store_true")
    a = ap.parse_args()
    if a.refresh_landscape:
        refresh_landscape()
    if a.cmd == "selftest":
        try:
            selftest()
        except AssertionError as e:
            print("SELFTEST FAIL: %s" % e)
            return 1
        return 0
    recs = load(a.store)
    if a.cmd in ("add", "upsert"):
        try:
            rec = json.loads(a.arg or "")
            assert isinstance(rec, dict)
        except (ValueError, AssertionError):
            print("need a JSON object argument", file=sys.stderr)
            return 2
        r = upsert(recs, dict(rec, last_verified=rec.get("last_verified") or now()))
        save(a.store, recs)
        print("upserted %s (%d total)" % (r["id"], len(recs)))
        return 0
    # first run seeds; idempotent thereafter
    if a.cmd == "seed" or not os.path.exists(a.store):
        n = seed(recs)
        if n:
            save(a.store, recs)
        if a.cmd == "seed":
            print("seeded %d new (%d total)" % (n, len(recs)))
            return 0
    if a.cmd == "list":
        for r in recs.values():
            print(json.dumps(r, sort_keys=True))
    elif a.cmd == "get":
        r = recs.get(a.arg or "")
        if not r:
            print("not found: %s" % a.arg, file=sys.stderr)
            return 1
        print(json.dumps(r, indent=2, sort_keys=True))
    elif a.cmd == "render":
        render(recs)
    elif a.cmd == "stats":
        stats(recs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
