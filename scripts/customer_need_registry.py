#!/usr/bin/env python3
"""customer_need_registry.py — durable registry of what customers need and what blocks conversion.

The money loop's scout/skeptic/distribution personalities learn customer needs,
objections and routes constantly; this keeps them as upsertable records instead of
prose. One record per need, keyed by `id` slug:
  {id, need, evidence_source, buyer_archetype, our_route_or_product,
   conversion_blocker, status, last_updated, notes}

  customer_need_registry.py add|upsert '<json>'   (partial records OK; upsert merges into existing id)
  customer_need_registry.py list
  customer_need_registry.py get <id>
  customer_need_registry.py render                (table)
  customer_need_registry.py stats                 (counts by status, by buyer_archetype)
  customer_need_registry.py seed                  (idempotent; never overwrites an existing id)
  customer_need_registry.py selftest

Store: ~/.hermes/data/x402_margin/needs.jsonl (override: --store PATH or
CUSTOMER_NEED_REGISTRY_STORE). Degrades OPEN: missing/corrupt store reads as empty.
Usage: python3 -I scripts/customer_need_registry.py <cmd>
"""
import collections
import datetime
import json
import os
import re
import sys
import tempfile

DEFAULT_STORE = os.path.expanduser("~/.hermes/data/x402_margin/needs.jsonl")
FIELDS = ["id", "need", "evidence_source", "buyer_archetype", "our_route_or_product",
          "conversion_blocker", "status", "last_updated", "notes"]

SEEDS = [
    {"id": "multichain-token-safety",
     "need": "multi-chain token-safety verdicts before a trade",
     "evidence_source": "competitor buyer targeting + outreach objections",
     "buyer_archetype": "multi-chain trading agents",
     "our_route_or_product": "/chain/token-report",
     "conversion_blocker": "we're Base-only, they use free GoPlus",
     "status": "open"},
    {"id": "mcp-server-injection-scan",
     "need": "scan own MCP servers for prompt-injection / tool-poisoning",
     "evidence_source": "warm lead thread (LiquidLogicX)",
     "buyer_archetype": "teams running their own MCP servers (e.g. LiquidLogicX)",
     "our_route_or_product": "/scan/mcp",
     "conversion_blocker": "",
     "status": "warm"},
    {"id": "pretrade-decision-gate",
     "need": "single allow/deny gate in front of a swap",
     "evidence_source": "warm lead threads (DopamineDesk, agenticpay)",
     "buyer_archetype": "Base trading agents / integrators (e.g. DopamineDesk, agenticpay)",
     "our_route_or_product": "/gate/swap",
     "conversion_blocker": "",
     "status": "warm"},
    {"id": "paywalled-llm-inference-fallback",
     "need": "pay-per-call LLM inference fallback when a primary provider is paywalled/down",
     "evidence_source": "warm lead thread (adexto)",
     "buyer_archetype": "router / agent devs (e.g. adexto)",
     "our_route_or_product": "/v1/chat/completions",
     "conversion_blocker": "",
     "status": "warm"},
    {"id": "finished-outcome-resold-to-humans",
     "need": "finished outcome resold to a human audience with x402 invisible on the backend",
     "evidence_source": "margin thesis (MONEY_LOOP_MARGIN_THESIS_AND_CREW.md)",
     "buyer_archetype": "prosumers",
     "our_route_or_product": "",
     "conversion_blocker": "need audience+fiat front",
     "status": "hypothesis"},
]


def store_path():
    return os.environ.get("CUSTOMER_NEED_REGISTRY_STORE") or DEFAULT_STORE


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def load():
    """id -> record, last write wins. Degrade-open to {}."""
    out = {}
    try:
        with open(store_path()) as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    r = json.loads(ln)
                except Exception:
                    continue
                if isinstance(r, dict) and r.get("id"):
                    out[str(r["id"])] = r
    except Exception:
        return {}
    return out


def save(recs):
    p = store_path()
    d = os.path.dirname(os.path.abspath(p))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".needs.", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        for r in recs.values():
            f.write(json.dumps(r, sort_keys=True) + "\n")
    os.replace(tmp, p)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:60]


def upsert(rec):
    """Merge rec into the stored record with the same id. Returns (id, created)."""
    if not isinstance(rec, dict):
        raise ValueError("record must be a JSON object")
    rid = slug(rec.get("id") or rec.get("need") or "")
    if not rid:
        raise ValueError("record needs an `id` (or a `need` to derive one)")
    recs = load()
    created = rid not in recs
    cur = recs.get(rid) or {k: "" for k in FIELDS}
    for k, v in rec.items():
        if k in ("id", "last_updated") or v is None:
            continue
        cur[k] = v
    cur["id"] = rid
    cur["status"] = cur.get("status") or "open"
    cur["last_updated"] = now()
    recs[rid] = cur
    save(recs)
    return rid, created


def seed():
    recs = load()
    n = 0
    for s in SEEDS:
        if s["id"] not in recs:
            upsert(s)
            n += 1
    print("seeded %d new (%d total)" % (n, len(load())))
    return 0


def render():
    recs = sorted(load().values(), key=lambda r: (str(r.get("status")), str(r.get("id"))))
    if not recs:
        print("(no needs recorded)")
        return
    cols = [("id", 32), ("status", 10), ("buyer_archetype", 38), ("our_route_or_product", 22), ("conversion_blocker", 40)]
    print(" | ".join(c.ljust(w) for c, w in cols))
    print("-+-".join("-" * w for _, w in cols))
    for r in recs:
        print(" | ".join(str(r.get(c, "") or "").replace("\n", " ")[:w].ljust(w) for c, w in cols))


def stats():
    recs = load().values()
    print("total=%d" % len(recs))
    for title, key in (("by status", "status"), ("by buyer_archetype", "buyer_archetype")):
        c = collections.Counter(str(r.get(key) or "?") for r in recs)
        print("%s:" % title)
        for k, v in sorted(c.items()):
            print("  %s: %d" % (k, v))


def selftest():
    d = tempfile.mkdtemp(prefix="cnr_selftest_")
    os.environ["CUSTOMER_NEED_REGISTRY_STORE"] = os.path.join(d, "needs.jsonl")
    try:
        assert load() == {}, "missing store must read as empty"
        rid, created = upsert({"id": "x1", "need": "n", "buyer_archetype": "a"})
        assert rid == "x1" and created, "add should create"
        rid, created = upsert({"id": "x1", "status": "warm"})
        assert not created, "second upsert must update, not create"
        g = load()["x1"]
        assert g["status"] == "warm" and g["need"] == "n" and g["buyer_archetype"] == "a", "partial upsert must merge: %r" % g
        upsert({"need": "Derived Slug Need"})
        assert "derived-slug-need" in load(), "id derives from need"
        try:
            upsert({"notes": "no id"})
            raise AssertionError("record without id/need must be rejected")
        except ValueError:
            pass
        assert len(load()) == 2, "dedup: x1 stored once"
        with open(store_path(), "a") as f:
            f.write("{corrupt\n")
        assert len(load()) == 2, "corrupt line must be skipped"
        seed()
        seed()
        assert len(load()) == 2 + len(SEEDS), "seed must be idempotent"
        os.remove(store_path())
        assert load() == {}
        print("SELFTEST OK")
        return 0
    except AssertionError as e:
        print("SELFTEST FAIL: %s" % e)
        return 1
    finally:
        os.environ.pop("CUSTOMER_NEED_REGISTRY_STORE", None)


def main(a):
    if "--store" in a:
        i = a.index("--store")
        os.environ["CUSTOMER_NEED_REGISTRY_STORE"] = a[i + 1]
        a = a[:i] + a[i + 2:]
    if len(a) < 2:
        print(__doc__)
        return 2
    c = a[1]
    if c in ("add", "upsert") and len(a) > 2:
        try:
            rid, created = upsert(json.loads(a[2]))
        except Exception as e:
            print("REJECTED: %s" % e)
            return 2
        print("%s %s" % ("created" if created else "updated", rid))
        return 0
    if c == "list":
        for r in sorted(load().values(), key=lambda r: str(r.get("id"))):
            print("  [%s] %s — %s" % (r.get("id"), r.get("status"), str(r.get("need", ""))[:90]))
        return 0
    if c == "get" and len(a) > 2:
        r = load().get(a[2])
        if not r:
            print("id not found")
            return 1
        print(json.dumps(r, indent=2, sort_keys=True))
        return 0
    if c == "render":
        render()
        return 0
    if c == "stats":
        stats()
        return 0
    if c == "seed":
        return seed()
    if c == "selftest":
        return selftest()
    print("unknown cmd")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
