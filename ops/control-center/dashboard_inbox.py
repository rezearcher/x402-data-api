#!/usr/bin/env python3
"""dashboard_inbox.py — the Loop Control Center's INBOX: the single triage surface that REPLACES
Rez's email mailbox for fleet alerts + the daily brief.

Rez (2026-11-04): "this dashboard replaces the daily email to my mailbox, and the alerts going to my
mailbox go to this dashboard instead." So every message that used to be emailed POSTS here instead, and
the dashboard renders it as a notification-center / triage surface.

Design follows current notification-center UX (triage, not a firehose):
  • BUNDLE — a re-firing alert with the same dedup_key does NOT stack a new row; it increments a count
    and refreshes the timestamp on the one open row. One recurring problem = one line, honest count.
  • "unread = worth ACTING ON", not "technically new" — a resolved item leaves the unread count.
  • DISTINCT STATES — unread -> ack (seen, still open) -> resolved (done). Reading ≠ resolving, exactly
    like a Rez-atom: you can read an approval request and it still awaits the decision.
  • SEVERITY — info / warn / crit drives colour + ordering; crit floats to the top.

Append-only event log (never mutated in place): ~/.hermes/data/dashboard_inbox/inbox.jsonl. Current
state = fold of the events (latest state per id wins). stdlib-only (the server is stdlib-only).

Library:  post(title, body=..., severity=..., source=..., kind=..., dedup_key=..., bundle=...)
          current(include_resolved=False) -> [records newest-first]
          set_state(id, state)            -> True/False
          unread_count() -> int
CLI:      python3 dashboard_inbox.py post --title "..." [--body ...] [--severity warn] [--source x]
          python3 dashboard_inbox.py list [--all]
          python3 dashboard_inbox.py ack|resolve <id>
"""
from __future__ import annotations
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

DIR = Path(os.environ.get("DASHBOARD_INBOX_DIR", os.path.expanduser("~/.hermes/data/dashboard_inbox")))
LOG = DIR / "inbox.jsonl"
SEVERITY_RANK = {"crit": 0, "warn": 1, "info": 2}
OPEN_STATES = ("unread", "ack")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(dedup_key: str) -> str:
    return hashlib.sha1(dedup_key.encode()).hexdigest()[:12]


def _append(ev: dict) -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    # atomic-ish append; the event log is the source of truth, latest state per id wins on fold
    with open(LOG, "a") as f:
        f.write(json.dumps(ev, sort_keys=True) + "\n")


def _events() -> list[dict]:
    out = []
    if LOG.exists():
        with open(LOG) as f:
            for ln in f:
                ln = ln.strip()
                if ln:
                    try:
                        out.append(json.loads(ln))
                    except Exception:
                        continue
    return out


def _fold() -> dict:
    """Replay events into current records. A 'post' with an existing OPEN id BUNDLES (count++, refresh
    ts) rather than duplicating; a 'state' event moves the item through unread->ack->resolved."""
    rec: dict[str, dict] = {}
    for ev in _events():
        t = ev.get("type")
        rid = ev.get("id")
        if not rid:
            continue
        if t == "post":
            if rid in rec and rec[rid].get("state") in OPEN_STATES:
                r = rec[rid]
                r["count"] = r.get("count", 1) + 1
                r["ts"] = ev.get("ts", r["ts"])          # most-recent occurrence
                r["last_body"] = ev.get("body", r.get("last_body", ""))
                # a recurrence of a resolved-then-reopened item is handled by state events below
            else:
                rec[rid] = {
                    "id": rid, "kind": ev.get("kind", "alert"), "severity": ev.get("severity", "info"),
                    "source": ev.get("source", ""), "title": ev.get("title", ""), "body": ev.get("body", ""),
                    "last_body": ev.get("body", ""), "first_ts": ev.get("ts", _now()), "ts": ev.get("ts", _now()),
                    "state": "unread", "state_ts": ev.get("ts", _now()), "count": 1,
                    "href": ev.get("href"), "atom_id": ev.get("atom_id"),
                    "dedup_origin": ev.get("dedup_origin", ""),
                }
        elif t == "state" and rid in rec:
            rec[rid]["state"] = ev.get("state", rec[rid]["state"])
            rec[rid]["state_ts"] = ev.get("ts", _now())
    return rec


def post(title: str, body: str = "", severity: str = "info", source: str = "", kind: str = "alert",
         dedup_key: str | None = None, href: str | None = None, atom_id: str | None = None) -> str:
    """Post a message to the inbox. dedup_key controls bundling (default: title+source), so the same
    recurring alert collapses onto one row. Returns the record id."""
    title = " ".join((title or "").split()).strip()
    if not title:
        return ""
    if severity not in SEVERITY_RANK:
        severity = "info"
    dk = dedup_key or f"{kind}:{source}:{title}"
    rid = _id(dk)
    _append({"type": "post", "id": rid, "ts": _now(), "kind": kind, "severity": severity,
             "source": source, "title": title, "body": body or "", "href": href, "atom_id": atom_id,
             "dedup_origin": dk})
    return rid


def set_state(rid: str, state: str) -> bool:
    if state not in ("unread", "ack", "resolved"):
        return False
    if rid not in _fold():
        return False
    _append({"type": "state", "id": rid, "ts": _now(), "state": state})
    return True


def current(include_resolved: bool = False, limit: int = 200) -> list[dict]:
    recs = list(_fold().values())
    if not include_resolved:
        recs = [r for r in recs if r.get("state") in OPEN_STATES]
    recs.sort(key=lambda r: (SEVERITY_RANK.get(r.get("severity"), 3),
                             0 if r.get("state") == "unread" else 1,
                             _neg_ts(r.get("ts", ""))))
    return recs[:limit]


def _neg_ts(ts: str) -> float:
    try:
        return -datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def unread_count() -> int:
    return sum(1 for r in _fold().values() if r.get("state") == "unread")


def id_for(dedup_key: str) -> str:
    """Stable id a caller can compute to later resolve its own item (e.g. a recovered sensor)."""
    return _id(dedup_key)


def open_ids_by_prefix(dedup_prefix: str) -> list[str]:
    """Open item ids whose dedup-origin matches — used by ingest to auto-resolve recovered sensors.
    We tag each posted record's origin in 'dedup_origin' so recovery can find it without re-deriving."""
    return [rid for rid, r in _fold().items()
            if r.get("state") in OPEN_STATES and str(r.get("dedup_origin", "")).startswith(dedup_prefix)]


def snapshot() -> dict:
    """What the dashboard reads: open items + explicit, honest counts (per notification-center UX)."""
    fold = _fold()
    open_items = current(include_resolved=False)
    return {
        "items": open_items,
        "counts": {
            "unread": sum(1 for r in fold.values() if r.get("state") == "unread"),
            "open": sum(1 for r in fold.values() if r.get("state") in OPEN_STATES),
            "crit_open": sum(1 for r in fold.values()
                             if r.get("state") in OPEN_STATES and r.get("severity") == "crit"),
            "total": len(fold),
        },
        "fetched_at": _now(),
    }


def _main(argv):
    if not argv:
        print(__doc__.strip().splitlines()[0])
        return 0
    cmd = argv[0]
    if cmd == "post":
        import argparse
        ap = argparse.ArgumentParser()
        ap.add_argument("--title", required=True)
        ap.add_argument("--body", default="")
        ap.add_argument("--severity", default="info")
        ap.add_argument("--source", default="cli")
        ap.add_argument("--kind", default="alert")
        ap.add_argument("--dedup-key", default=None)
        a = ap.parse_args(argv[1:])
        print(post(a.title, a.body, a.severity, a.source, a.kind, a.dedup_key))
    elif cmd == "list":
        for r in current(include_resolved=("--all" in argv)):
            print(f"[{r['severity'][:4]:4}] {r['state']:8} {r['id']}  x{r.get('count',1)}  {r['title'][:70]}  ({r['source']})")
    elif cmd in ("ack", "resolve") and len(argv) > 1:
        print("ok" if set_state(argv[1], "ack" if cmd == "ack" else "resolved") else "(no such id)")
    elif cmd == "snapshot":
        print(json.dumps(snapshot(), indent=2))
    else:
        print("usage: post|list|ack <id>|resolve <id>|snapshot", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
