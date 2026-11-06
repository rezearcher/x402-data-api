"""board.py - generic status board over ~/.hermes/data/<name>/latest.json (display logic only).

Reads only the generic fields status / summary / alert / retired as opaque values. Groups:
  FAULT - status in error/alert/degraded/stale, or the file failed to parse (fail loud)
  STALE - file mtime older than 3x its interval (interval_seconds / interval_s field if present),
          else older than 48h
  INFO  - alert set but status ok (collapsed in the UI, not counted toward the alert total)
Retired entries are skipped and only counted. stdlib only.
"""
from __future__ import annotations
import fnmatch
import json
import logging
import os
import re
import time
from pathlib import Path

log = logging.getLogger("board")

DATA = Path(os.environ.get("BOARD_DATA_DIR", os.path.expanduser("~/.hermes/data")))
PRIORITY_FILE = Path(os.environ.get("BOARD_PRIORITY_FILE", Path(__file__).resolve().parent / "board_priority.json"))
FAULT_STATUSES = {"error", "alert", "degraded", "stale"}
DEFAULT_STALE_S = 48 * 3600
_warned_missing = False


def load_priority(path: Path | None = None) -> list[str]:
    """Priority patterns from the editable config; missing/unreadable degrades to [] (alphabetical)."""
    global _warned_missing
    p = path or PRIORITY_FILE
    try:
        pats = json.loads(p.read_text()).get("priority", [])
        if not isinstance(pats, list):
            raise ValueError("'priority' must be a list")
        _warned_missing = False
        return [str(x) for x in pats]
    except Exception as e:
        if not _warned_missing:
            log.warning("board priority config %s unusable (%s); falling back to alphabetical", p, e)
            _warned_missing = True
        return []


def _rank(name: str, pats: list[str]) -> int:
    for i, pat in enumerate(pats):
        if fnmatch.fnmatchcase(name, pat):
            return i
    return len(pats)


def _interval(d: dict):
    for k in ("interval_seconds", "interval_s"):
        v = d.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            return float(v)
    return None


def build_board(data_dir: Path | None = None, priority: list[str] | None = None, now: float | None = None) -> dict:
    root = data_dir or DATA
    now = time.time() if now is None else now
    pats = load_priority() if priority is None else priority
    faults, stale, info = [], [], []
    retired = 0
    files = sorted(root.glob("*/latest.json")) if root.exists() else []
    for f in files:
        name = f.parent.name
        try:
            age_s = max(0.0, now - f.stat().st_mtime)
        except OSError:
            age_s = None
        try:
            d = json.loads(f.read_text())
            if not isinstance(d, dict):
                raise ValueError(f"top-level JSON is {type(d).__name__}, expected object")
        except Exception as e:
            faults.append({"name": name, "status": "parse_error", "summary": f"{type(e).__name__}: {e}",
                           "alert": True, "age_s": age_s})
            continue
        if d.get("retired") is True:
            retired += 1
            continue
        status = str(d.get("status", "")).strip().lower()
        row = {"name": name, "status": status or "unknown", "summary": str(d.get("summary", "")),
               "alert": bool(d.get("alert")), "age_s": age_s}
        limit = 3 * (_interval(d) or 0) or DEFAULT_STALE_S
        if status in FAULT_STATUSES:
            faults.append(row)
        elif age_s is not None and age_s > limit:
            stale.append(row)
        elif row["alert"] and status == "ok":
            info.append(row)
    faults.sort(key=lambda r: (_rank(r["name"], pats), r["name"]))
    stale.sort(key=lambda r: r["name"])
    info.sort(key=lambda r: r["name"])
    return {"faults": faults, "stale": stale, "info": info,
            "counts": {"faults": len(faults), "stale": len(stale), "info": len(info), "retired_hidden": retired}}


_HEX = re.compile(r"0x[0-9a-fA-F]+|\b(?=[0-9a-fA-F]*\d)(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{6,}\b")


def title_key(title: str) -> str:
    return re.sub(r"\d+", "#", _HEX.sub("#", title or ""))


def collapse_inbox(items: list[dict]) -> list[dict]:
    """Group inbox items whose titles match after digit/hex normalisation; count + last-seen per group."""
    groups: dict[str, dict] = {}
    for it in items:
        k = title_key(it.get("title", ""))
        g = groups.get(k)
        n = it.get("count", 1) or 1
        ts = it.get("ts", "")
        if g is None:
            groups[k] = {"title": k, "example_title": it.get("title", ""), "count": n, "last_seen": ts,
                         "severity": it.get("severity", "info"), "ids": [it.get("id")],
                         "unread": it.get("state") == "unread", "source": it.get("source", ""),
                         "body": it.get("last_body") or it.get("body", "")}
        else:
            g["count"] += n
            g["ids"].append(it.get("id"))
            g["unread"] = g["unread"] or it.get("state") == "unread"
            if ts > g["last_seen"]:
                g["last_seen"] = ts
                g["body"] = it.get("last_body") or it.get("body", "")
            if _sev(it.get("severity")) < _sev(g["severity"]):
                g["severity"] = it.get("severity")
    return sorted(groups.values(), key=lambda g: (_sev(g["severity"]), _neg(g["last_seen"])))


def _sev(s):
    return {"crit": 0, "warn": 1, "info": 2}.get(s, 3)


def _neg(ts: str) -> float:
    from datetime import datetime
    try:
        return -datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0
