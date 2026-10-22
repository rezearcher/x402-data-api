#!/usr/bin/env python3
"""money_research_queue.py — demand-driven research queue for the x402 money loop.

The loop's personalities (scout, skeptic, distribution, economist, judge) hit gaps
while working: a number they cannot compute, a channel they cannot size, a competitor
they cannot name. Instead of burying that in prose, they queue the question here with
the claim it unblocks, and the researcher drains the most valuable ones FIRST.
Mirrors arb-loop research_queue.py (add/next/done/dead/list + dedup), scoped to
money / customer / competitor research.

  money_research_queue.py add "<question / what to find>" --from scout|skeptic|distribution|economist|judge|rez|reply
                              --reason "<why / what it unblocks>" [--priority 1-5] [--source-url U]
      (--reason is REQUIRED unless --from rez|reply — vague "look into X" is rejected)
  money_research_queue.py next [N]    -> top-N pending, priority 1 = most urgent, then oldest first (default 3)
  money_research_queue.py done <id>   -> answered and banked
  money_research_queue.py dead <id>   -> adjudicated unanswerable; will not re-queue
  money_research_queue.py list [N]
  money_research_queue.py stats
  money_research_queue.py seed        -> idempotent starter questions
  money_research_queue.py selftest

Store: ~/.hermes/data/x402_margin/research_queue.jsonl (override: --store PATH or
MONEY_RESEARCH_QUEUE_STORE). Degrades OPEN: missing/corrupt store reads as empty.
"""
import collections
import datetime
import hashlib
import json
import os
import sys
import tempfile

DEFAULT_STORE = os.path.expanduser("~/.hermes/data/x402_margin/research_queue.jsonl")
ROLES = ("scout", "skeptic", "distribution", "economist", "judge", "rez", "reply")
NO_REASON_OK = ("rez", "reply")   # a human/customer ask is its own justification

SEEDS = [
    ("What free hook + installed surface could make us BlockRun-for-crypto-agent-devs? (channel + reach evidence)",
     "distribution", 1, "distribution is the binding constraint; need a channel with named reach before building more product"),
    ("Is x402 open-model inference actually cheaper than the retail API an AI-wrapper micro-SaaS pays? compute the spread",
     "economist", 1, "the reback-inference-via-x402 margin thesis only holds if the spread is positive after fees"),
    ("Which Acquire.com/Flippa AI-wrapper listings have high inference COGS we could reback via x402? (names + MRR)",
     "scout", 2, "turns the margin thesis into a named prospect list with revenue to size the prize"),
]


def store_path():
    return os.environ.get("MONEY_RESEARCH_QUEUE_STORE") or DEFAULT_STORE


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def load():
    out = []
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
                if isinstance(r, dict):
                    out.append(r)
    except Exception:
        return []
    return out


def save(rows):
    p = store_path()
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(p)), prefix=".rq.", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    os.replace(tmp, p)


def norm(t):
    return " ".join((t or "").lower().split())


def parse_priority(v):
    try:
        return min(5, max(1, int(v)))
    except Exception:
        return 3


def add(text, frm="", url="", reason="", priority=3):
    if not norm(text):
        print("REJECTED: empty question")
        return 2
    if frm and frm not in ROLES:
        print("REJECTED: --from must be one of " + "|".join(ROLES))
        return 2
    if frm not in NO_REASON_OK and not (reason or "").strip():
        print("REJECTED: requests must name what they unblock via --reason")
        return 2
    rows = load()
    n = norm(text)
    for r in rows:
        if norm(r.get("request")) == n and r.get("status") in ("pending", "dead_end"):
            print("skip (already %s): %s" % (r["status"], r.get("id")))
            return 0
    rid = hashlib.sha1((n + (url or "")).encode()).hexdigest()[:10]
    rows.append({"id": rid, "ts": now(), "request": text, "from": frm or "?", "source_url": url or "",
                 "reason": reason or "", "priority": parse_priority(priority), "status": "pending"})
    save(rows)
    print("queued %s (from %s, pri %s)" % (rid, frm or "?", parse_priority(priority)))
    return 0


def pending_sorted():
    p = [r for r in load() if r.get("status") == "pending"]
    p.sort(key=lambda r: (parse_priority(r.get("priority", 3)), r.get("ts", "")))
    return p


def nxt(n=3):
    p = pending_sorted()
    if not p:
        print("(queue empty — scout/economist: find the next unanswered customer or margin question)")
        return
    for r in p[:n]:
        print("  [%s] pri %s from %s: %s" % (r.get("id"), r.get("priority"), r.get("from"), r.get("request", "")[:140])
              + ("  url=" + r["source_url"] if r.get("source_url") else "")
              + ("  — " + r["reason"][:90] if r.get("reason") else ""))


def setstatus(rid, st):
    rows = load()
    hit = False
    for r in rows:
        if r.get("id") == rid:
            r["status"] = st
            r[st + "_ts"] = now()
            hit = True
    if hit:
        save(rows)
    print(st if hit else "id not found")
    return 0 if hit else 1


def stats():
    rows = load()
    print("total=%d" % len(rows))
    for title, key in (("by status", "status"), ("by from", "from")):
        c = collections.Counter(str(r.get(key, "?")) for r in rows)
        print("%s: %s" % (title, ", ".join("%s=%d" % kv for kv in sorted(c.items())) or "(none)"))
    pc = collections.Counter(str(r.get("priority", "?")) for r in rows if r.get("status") == "pending")
    print("pending by priority: %s" % (", ".join("p%s=%d" % kv for kv in sorted(pc.items())) or "(none)"))


def seed():
    for q, frm, pri, why in SEEDS:
        add(q, frm, "", why, pri)
    return 0


def selftest():
    d = tempfile.mkdtemp(prefix="mrq_selftest_")
    os.environ["MONEY_RESEARCH_QUEUE_STORE"] = os.path.join(d, "q.jsonl")
    try:
        assert load() == [], "missing store must read as empty"
        assert add("Q low", "scout", "", "why a", 4) == 0
        assert add("Q high", "economist", "", "why b", 1) == 0
        assert add("Q high", "economist", "", "why b", 1) == 0 and len(load()) == 2, "dedup failed"
        assert add("no reason", "judge", "", "", 1) == 2, "judge without reason must be rejected"
        assert add("human ask", "rez", "", "", 5) == 0, "rez needs no reason"
        assert add("bad role", "nobody", "", "x", 1) == 2, "unknown role must be rejected"
        top = pending_sorted()[0]
        assert top["request"] == "Q high", "next must return priority 1 first: %r" % top
        assert setstatus(top["id"], "done") == 0
        assert pending_sorted()[0]["request"] == "Q low" or pending_sorted()[0]["request"] == "human ask"
        assert pending_sorted()[0]["priority"] == 4, "after done, next lowest priority number wins"
        assert setstatus("nope", "done") == 1
        assert add("Q high", "economist", "", "why b", 1) == 0, "done items may be re-queued"
        with open(store_path(), "a") as f:
            f.write("{corrupt\n")
        assert len(load()) == 4, "corrupt line must be skipped, not crash"
        os.remove(store_path())
        assert load() == []
        stats()
        print("SELFTEST OK")
        return 0
    except AssertionError as e:
        print("SELFTEST FAIL: %s" % e)
        return 1
    finally:
        os.environ.pop("MONEY_RESEARCH_QUEUE_STORE", None)


def main(a):
    if "--store" in a:
        i = a.index("--store")
        os.environ["MONEY_RESEARCH_QUEUE_STORE"] = a[i + 1]
        a = a[:i] + a[i + 2:]
    if len(a) < 2:
        print(__doc__)
        return 2
    g = lambda k, d="": (a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else d)
    c = a[1]
    if c == "add" and len(a) > 2:
        return add(a[2], g("--from"), g("--source-url"), g("--reason"), g("--priority", 3))
    if c == "next":
        try:
            n = int(a[2]) if len(a) > 2 else 3
        except ValueError:
            n = 3
        nxt(n)
        return 0
    if c in ("done", "dead") and len(a) > 2:
        return setstatus(a[2], "done" if c == "done" else "dead_end")
    if c == "list":
        try:
            n = int(a[2]) if len(a) > 2 else 10
        except ValueError:
            n = 10
        for r in load()[-n:]:
            print("  [%s] %s p%s from %s: %s" % (r.get("id"), r.get("status"), r.get("priority"), r.get("from"), r.get("request", "")[:90]))
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
