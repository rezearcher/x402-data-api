#!/usr/bin/env python3
"""crew_stage.py — per-stage goal + deterministic judge state machine for the x402 money loop.

A candidate margin-play flows scout -> economist -> skeptic -> distribution -> builder -> judge.
Every stage has its OWN one-line goal and its OWN deterministic judge (a pure check on the
record). The loop stays in place at a stage until that stage's judge passes, then advances.
Mirrors the goal-loop pattern (goal + ungameable judge) applied at every stage, not just the end.
Goals and judges live in the STAGES dict below as data — edit them without touching logic.

  crew_stage.py new '<json>'            -> create a candidate at stage=scout, status=active
  crew_stage.py set <id> '<json>'       -> deep-merge fields (empty/missing never erase existing values)
  crew_stage.py status [--id ID]        -> active candidate, stage goal, judge criteria, missing fields
  crew_stage.py advance <id>            -> run the current judge: ADVANCED a->b | HOLD at s: missing ... | KILLED
  crew_stage.py park <id> --why "..."   -> park a candidate
  crew_stage.py activate <id>           -> un-park
  crew_stage.py list | render | stats
  crew_stage.py selftest

The judge stage passes only on judge.external_usdc_confirmed == true, which the loop sets only
from the oracle/revenue sensor, never by hand. Advancing never goes past judge (passing it = won).

Store: ~/.hermes/data/x402_margin/pipeline.jsonl (override: --store PATH or CREW_PIPELINE_STORE).
Degrades OPEN: missing/corrupt store reads as empty; partial records never crash.
"""
import argparse
import collections
import datetime
import json
import os
import re
import sys
import tempfile

DEFAULT_STORE = os.path.expanduser("~/.hermes/data/x402_margin/pipeline.jsonl")

# kinds: text = non-empty string, number = int/float (not bool), true = literal True,
# list = non-empty list, eq:X = string equal to X
STAGES = {
    "scout": {
        "goal": "nominate a concrete candidate",
        "criteria": "name, source, resells, audience_hypothesis all non-empty",
        "require": [("name", "text"), ("source", "text"), ("resells", "text"), ("audience_hypothesis", "text")],
    },
    "economist": {
        "goal": "prove the unit economics in code",
        "criteria": "econ.spread_usd is a number AND econ.computed_note non-empty",
        "require": [("econ.spread_usd", "number"), ("econ.computed_note", "text")],
    },
    "skeptic": {
        "goal": "survive an adversarial attack or be killed",
        "criteria": "skeptic.verdict == 'survive' AND skeptic.assumption non-empty (verdict 'kill' parks it)",
        "require": [("skeptic.verdict", "eq:survive"), ("skeptic.assumption", "text")],
        "kill_when": ("skeptic.verdict", "kill"),
        "kill_why": "skeptic.assumption",
    },
    "distribution": {
        "goal": "name a cheap channel to a real audience with evidence",
        "criteria": "distribution.channel AND distribution.reach_evidence non-empty",
        "require": [("distribution.channel", "text"), ("distribution.reach_evidence", "text")],
    },
    "builder": {
        "goal": "ship a real artifact",
        "criteria": "builder.artifacts is a non-empty list",
        "require": [("builder.artifacts", "list")],
    },
    "judge": {
        "goal": "confirmed external USDC",
        "criteria": "judge.external_usdc_confirmed is true (oracle/revenue sensor only, never by hand)",
        "require": [("judge.external_usdc_confirmed", "true")],
    },
}
ORDER = list(STAGES)


def store_path():
    return os.environ.get("CREW_PIPELINE_STORE") or DEFAULT_STORE


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
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(p)), prefix=".cs.", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    os.replace(tmp, p)


def slug(t):
    return re.sub(r"[^a-z0-9]+", "-", (t or "").lower()).strip("-")[:48]


def parse_json(s):
    try:
        v = json.loads(s)
    except Exception:
        return None
    return v if isinstance(v, dict) else None


def is_empty(v):
    return v is None or v == "" or v == [] or v == {}


def merge(dst, src):
    """Deep-merge src into dst; empty values never erase, lists union (order kept, no dupes)."""
    for k, v in src.items():
        if is_empty(v):
            continue
        if isinstance(v, dict):
            cur = dst.get(k)
            if not isinstance(cur, dict):
                cur = {}
            merge(cur, v)
            dst[k] = cur
        elif isinstance(v, list):
            cur = dst.get(k) if isinstance(dst.get(k), list) else []
            dst[k] = cur + [x for x in v if x not in cur]
        else:
            dst[k] = v
    return dst


def get(rec, path):
    cur = rec
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def ok(val, kind):
    if kind == "text":
        return isinstance(val, str) and bool(val.strip())
    if kind == "number":
        return isinstance(val, (int, float)) and not isinstance(val, bool)
    if kind == "true":
        return val is True
    if kind == "list":
        return isinstance(val, list) and len(val) > 0
    if kind.startswith("eq:"):
        return isinstance(val, str) and val.strip().lower() == kind[3:]
    return False


def stage_of(rec):
    s = rec.get("stage")
    return s if s in STAGES else "scout"


def missing(rec, stage=None):
    st = STAGES[stage or stage_of(rec)]
    return [p for p, kind in st["require"] if not ok(get(rec, p), kind)]


def killed(rec):
    kw = STAGES[stage_of(rec)].get("kill_when")
    if not kw:
        return False
    v = get(rec, kw[0])
    return isinstance(v, str) and v.strip().lower() == kw[1]


def find(rows, cid):
    for r in rows:
        if r.get("id") == cid:
            return r
    return None


def active_pick(rows):
    act = [r for r in rows if r.get("status", "active") == "active"]
    if not act:
        return None
    return max(act, key=lambda r: (ORDER.index(stage_of(r)), r.get("last_updated", "")))


def new(js):
    d = parse_json(js)
    if d is None:
        print("REJECTED: argument must be a JSON object")
        return 2
    cid = slug(d.get("id") or d.get("name"))
    if not cid:
        print("REJECTED: need id or name")
        return 2
    rows = load()
    if find(rows, cid):
        print("REJECTED: candidate exists: %s" % cid)
        return 2
    rec = {"id": cid, "stage": "scout", "status": "active"}
    merge(rec, d)
    rec.update({"id": cid, "stage": "scout", "status": "active", "last_updated": now()})
    rows.append(rec)
    save(rows)
    print("created %s at stage=scout" % cid)
    return 0


def set_(cid, js):
    d = parse_json(js)
    if d is None:
        print("REJECTED: argument must be a JSON object")
        return 2
    rows = load()
    r = find(rows, cid)
    if r is None:
        print("id not found")
        return 1
    protected = {k: r.get(k) for k in ("id", "stage", "status")}
    merge(r, d)
    r.update({k: v for k, v in protected.items() if v is not None})
    r["last_updated"] = now()
    save(rows)
    print("updated %s (stage=%s, missing: %s)" % (cid, stage_of(r), ", ".join(missing(r)) or "none"))
    return 0


def advance(cid):
    rows = load()
    r = find(rows, cid)
    if r is None:
        print("id not found")
        return 1
    if r.get("status", "active") != "active":
        print("HOLD at %s: candidate is %s" % (stage_of(r), r.get("status")))
        return 1
    st = stage_of(r)
    if killed(r):
        r["status"] = "parked"
        r["parked_why"] = str(get(r, STAGES[st]["kill_why"]) or "killed at " + st)
        r["last_updated"] = now()
        save(rows)
        print("KILLED at %s: parked (%s) — nominate a new candidate" % (st, r["parked_why"]))
        return 3
    miss = missing(r, st)
    if miss:
        print("HOLD at %s: missing %s" % (st, ", ".join(miss)))
        return 1
    r["last_updated"] = now()
    if st == ORDER[-1]:
        r["status"] = "won"
        save(rows)
        print("WON at %s: %s" % (st, STAGES[st]["goal"]))
        return 0
    nxt = ORDER[ORDER.index(st) + 1]
    r["stage"] = nxt
    save(rows)
    print("ADVANCED %s->%s" % (st, nxt))
    return 0


def park(cid, why):
    rows = load()
    r = find(rows, cid)
    if r is None:
        print("id not found")
        return 1
    r["status"] = "parked"
    r["parked_why"] = why or r.get("parked_why", "")
    r["last_updated"] = now()
    save(rows)
    print("parked %s" % cid)
    return 0


def activate(cid):
    rows = load()
    r = find(rows, cid)
    if r is None:
        print("id not found")
        return 1
    r["status"] = "active"
    r["last_updated"] = now()
    save(rows)
    print("activated %s at stage=%s" % (cid, stage_of(r)))
    return 0


def status(cid=""):
    rows = load()
    r = find(rows, cid) if cid else active_pick(rows)
    if r is None:
        print("id not found" if cid else "no active candidate\nstage: scout (nominate one)")
        return 1 if cid else 0
    st = stage_of(r)
    print("candidate: %s (%s)  status=%s" % (r.get("id"), r.get("name", ""), r.get("status", "active")))
    print("stage: %s" % st)
    print("STAGE GOAL: %s" % STAGES[st]["goal"])
    print("STAGE JUDGE: %s" % STAGES[st]["criteria"])
    miss = missing(r, st)
    print("missing to pass: %s" % (", ".join(miss) if miss else "none (run advance)"))
    if killed(r):
        print("NOTE: kill verdict recorded — advance will park it")
    if r.get("parked_why"):
        print("parked_why: %s" % r["parked_why"])
    return 0


def render():
    rows = load()
    print("%-34s %-14s %s" % ("id", "stage", "status"))
    for r in rows:
        print("%-34s %-14s %s" % (str(r.get("id", "?"))[:34], stage_of(r), r.get("status", "active")))
    if not rows:
        print("(no candidates)")


def list_():
    for r in load():
        print("  [%s] %s/%s %s" % (r.get("id"), stage_of(r), r.get("status", "active"), str(r.get("name", ""))[:70]))


def stats():
    rows = load()
    print("total=%d" % len(rows))
    for title, fn in (("by stage", stage_of), ("by status", lambda r: r.get("status", "active"))):
        c = collections.Counter(str(fn(r)) for r in rows)
        print("%s: %s" % (title, ", ".join("%s=%d" % kv for kv in sorted(c.items())) or "(none)"))


def selftest():
    d = tempfile.mkdtemp(prefix="crew_stage_selftest_")
    os.environ["CREW_PIPELINE_STORE"] = os.path.join(d, "p.jsonl")
    try:
        assert load() == [], "missing store must read as empty"
        assert active_pick(load()) is None
        assert new('{"name": "Alpha Play"}') == 0
        assert new('{"name": "Alpha Play"}') == 2, "duplicate id must be rejected"
        assert new("not json") == 2
        cid = "alpha-play"
        r = find(load(), cid)
        assert r["stage"] == "scout" and r["status"] == "active"
        assert advance(cid) == 1 and stage_of(find(load(), cid)) == "scout", "partial scout must HOLD"
        assert set_(cid, '{"source": "acquire.com", "resells": "inference", "audience_hypothesis": "wrapper devs"}') == 0
        assert advance(cid) == 0 and stage_of(find(load(), cid)) == "economist"
        assert set_(cid, '{"econ": {"spread_usd": 0.009}}') == 0
        assert advance(cid) == 1, "economist missing computed_note must HOLD"
        assert set_(cid, '{"econ": {"computed_note": "1c fiat - 0.1c wholesale", "spread_usd": ""}}') == 0
        assert find(load(), cid)["econ"]["spread_usd"] == 0.009, "empty value must not erase"
        assert advance(cid) == 0 and stage_of(find(load(), cid)) == "skeptic"
        assert set_(cid, '{"skeptic": {"verdict": "survive"}}') == 0
        assert advance(cid) == 1, "survive without assumption must HOLD"
        assert set_(cid, '{"skeptic": {"assumption": "audience converts"}}') == 0
        assert advance(cid) == 0 and stage_of(find(load(), cid)) == "distribution"
        assert set_(cid, '{"distribution": {"channel": "hermes catalog"}}') == 0
        assert advance(cid) == 1
        assert set_(cid, '{"distribution": {"reach_evidence": "255K stars"}}') == 0
        assert advance(cid) == 0 and stage_of(find(load(), cid)) == "builder"
        assert advance(cid) == 1, "builder without artifacts must HOLD"
        assert set_(cid, '{"builder": {"artifacts": ["scripts/tool.py"]}}') == 0
        assert set_(cid, '{"builder": {"artifacts": ["scripts/tool.py", "docs/x.md"]}}') == 0
        assert find(load(), cid)["builder"]["artifacts"] == ["scripts/tool.py", "docs/x.md"], "lists union"
        assert advance(cid) == 0 and stage_of(find(load(), cid)) == "judge"
        assert advance(cid) == 1, "judge without confirmed USDC must HOLD"
        assert set_(cid, '{"judge": {"external_usdc_confirmed": true, "note": "oracle"}}') == 0
        assert advance(cid) == 0 and find(load(), cid)["status"] == "won"
        assert stage_of(find(load(), cid)) == "judge", "never advance past judge"
        # kill path
        assert new('{"name": "Doomed", "source": "s", "resells": "r", "audience_hypothesis": "a"}') == 0
        did = "doomed"
        assert advance(did) == 0
        assert set_(did, '{"econ": {"spread_usd": -1, "computed_note": "negative"}}') == 0
        assert advance(did) == 0
        assert set_(did, '{"skeptic": {"verdict": "kill", "assumption": "no buyers"}}') == 0
        assert advance(did) == 3
        k = find(load(), did)
        assert k["status"] == "parked" and k["parked_why"] == "no buyers", "kill must park"
        assert advance(did) == 1, "parked must not advance"
        assert active_pick(load()) is None, "won/parked are not active"
        assert activate(did) == 0 and active_pick(load())["id"] == did
        assert park(did, "manual") == 0 and find(load(), did)["parked_why"] == "manual"
        # partial / corrupt records never crash
        with open(store_path(), "a") as f:
            f.write("{corrupt\n" + json.dumps({"id": "bare"}) + "\n" + json.dumps({"id": "odd", "stage": "zzz", "econ": "x"}) + "\n")
        assert len(load()) == 4, "corrupt line must be skipped"
        for cmd in (status, render, list_, stats):
            cmd()
        assert missing(find(load(), "odd")), "odd record falls back to scout and reports missing"
        os.remove(store_path())
        assert load() == []
        print("SELFTEST OK")
        return 0
    except AssertionError as e:
        print("SELFTEST FAIL: %s" % e)
        return 1
    finally:
        os.environ.pop("CREW_PIPELINE_STORE", None)


def main(a):
    if "--store" in a:
        i = a.index("--store")
        if i + 1 < len(a):
            os.environ["CREW_PIPELINE_STORE"] = a[i + 1]
            a = a[:i] + a[i + 2:]
    ap = argparse.ArgumentParser(prog="crew_stage.py", description="per-stage goal + judge state machine")
    sp = ap.add_subparsers(dest="cmd")
    for name, pos, opts in (("new", ("json",), ()), ("set", ("id", "json"), ()), ("status", (), ("--id",)),
                            ("advance", ("id",), ()), ("park", ("id",), ("--why",)), ("activate", ("id",), ())):
        p = sp.add_parser(name)
        for x in pos:
            p.add_argument(x)
        for o in opts:
            p.add_argument(o, default="")
    for n in ("list", "render", "stats", "selftest"):
        sp.add_parser(n)
    args = ap.parse_args(a[1:])
    c = args.cmd
    if c == "new":
        return new(args.json)
    if c == "set":
        return set_(args.id, args.json)
    if c == "status":
        return status(args.id)
    if c == "advance":
        return advance(args.id)
    if c == "park":
        return park(args.id, args.why)
    if c == "activate":
        return activate(args.id)
    if c == "list":
        list_()
        return 0
    if c == "render":
        render()
        return 0
    if c == "stats":
        stats()
        return 0
    if c == "selftest":
        return selftest()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
