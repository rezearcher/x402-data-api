#!/usr/bin/env python3
"""Loop Control Center — state builder.

Pure reader: turns the money-loop's existing artifacts (per-agent ledgers +
transcripts, chain/routine logs, revenue sensors, publish ledger, git, crew_stage)
into one /api/state JSON, and emits the `loop-money` shared sensor so the Daily
Brief / self-heal see loop health too (one spine, two consumers).

Degrade-open: every source is wrapped; a missing/broken source yields empty, never
a crash. Run standalone: `python3 state_builder.py | jq`.
"""
from __future__ import annotations
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
GL = HOME / ".claude" / "goal-loop-logs"
CHAIN = HOME / ".claude" / "agent-chain-logs"
REVDIR = HOME / ".hermes" / "data" / "x402-revenue"
REPO = Path("/home/rez/projects/x402-data-api")
MONITOR_FLAG = HOME / ".claude" / "agent-chains" / "monitor.flag"
MONITOR_FEED = CHAIN / "monitor.feed.jsonl"
SENSOR = HOME / ".hermes" / "data" / "loop-money" / "latest.json"
AGENTS = ["research", "builder", "marketing"]
EXPECT_RUN = (12, 32)   # expected pass run minutes
EXPECT_REST = (8, 20)   # expected rest minutes (target ~10)


def _safe(fn, default):
    try:
        return fn()
    except Exception:
        return default


def _read(p: Path, limit=200_000) -> str:
    return p.read_text(errors="replace")[-limit:] if p.exists() else ""


def latest_transcript(agent: str) -> Path | None:
    d = GL / f"chain-money-{agent}" / "history"
    js = sorted(d.glob("*.jsonl"), key=lambda x: x.stat().st_mtime) if d.exists() else []
    return js[-1] if js else None


def agent_now(agent: str) -> dict:
    """Latest assistant narration = 'what it's talking about now' + liveness."""
    t = latest_transcript(agent)
    if not t:
        return {"now": "", "live": False, "age_s": None}
    age = int(time.time() - t.stat().st_mtime)
    text = ""
    for line in reversed(_read(t).splitlines()):
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get("type") == "assistant":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") == "text" and b.get("text", "").strip():
                    text = b["text"].strip()
                    break
        if text:
            break
    return {"now": text[:400], "live": age < 180, "age_s": age}


def agent_history(agent: str, n=8) -> list:
    """Parse the progress ledger into cycle entries (newest first)."""
    led = GL / f"chain-money-{agent}" / "progress.ledger.md"
    txt = _read(led)
    entries = []
    for m in re.finditer(r"### cycle .*?—\s*([0-9T:\-Z]+).*?(?=\n### cycle |\Z)", txt, re.S):
        block = m.group(0)
        ts = m.group(1)
        did = (re.search(r"^DID:\s*(.+)$", block, re.M) or [None, ""])[1]
        nxt = (re.search(r"^NEXT:\s*(.+)$", block, re.M) or [None, ""])[1]
        atom = (re.search(r"^ATOM:\s*(.+)$", block, re.M) or [None, ""])[1]
        entries.append({"ts": ts, "did": did[:300], "next": nxt[:200], "atom": atom[:120]})
    return list(reversed(entries))[:n]


def parse_routine() -> dict:
    """Engine liveness, current stage, pass number, and rhythm timings."""
    txt = _read(CHAIN / "money.routine.log")
    rows = []
    for line in txt.splitlines():
        m = re.match(r"\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z\]\s+agent-chain\[\d+\]:\s+(.*)", line)
        if m:
            rows.append((datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc), m.group(2)))

    # alive?
    alive, pid = False, None
    try:
        out = subprocess.run(["pgrep", "-f", r"agent_chain\.sh --chain"], capture_output=True, text=True, timeout=5).stdout.split()
        alive = bool(out); pid = int(out[0]) if out else None
    except Exception:
        pass
    # current stage (which chain-money-* claude is running)
    stage = "rest"
    try:
        ps = subprocess.run(["pgrep", "-af", "name chain-money"], capture_output=True, text=True, timeout=5).stdout
        for a in AGENTS:
            if f"chain-money-{a}" in ps:
                stage = a
    except Exception:
        pass

    # rhythm: reconstruct per-pass run durations + rests between passes
    runs, rests = [], []
    seg = {}
    last_pass_end = None
    cur_pass = None
    for t, msg in rows:
        if "agent 1/3: research" in msg:
            seg = {"start": t}
            if last_pass_end:
                rests.append((t - last_pass_end).total_seconds() / 60.0)
        elif "PASS" in msg and "done" in msg:
            if "start" in seg:
                runs.append((t - seg["start"]).total_seconds() / 60.0)
            last_pass_end = t
            mnum = re.search(r"PASS (\d+) done", msg)
            cur_pass = int(mnum.group(1)) if mnum else cur_pass
        mnum = re.search(r"=== PASS (\d+)", msg)
        if mnum:
            cur_pass = int(mnum.group(1))
    return {"alive": alive, "pid": pid, "stage": stage, "pass": cur_pass,
            "runs": [round(x, 1) for x in runs[-12:]], "rests": [round(x, 1) for x in rests[-12:]]}


def revenue() -> dict:
    a = _safe(lambda: json.loads(_read(REVDIR / "latest.json")), {})
    b = _safe(lambda: json.loads(_read(REVDIR / "fiat_latest.json")), {})
    bfiat = b.get("total_gross_usd")
    if bfiat is None:
        bfiat = (b.get("fiat") or {}).get("total_gross_usd", 0.0)
    return {
        "line_a_balance_usdc": a.get("balance_usdc"),
        "line_a_external_usdc": a.get("total_external_usdc"),
        "line_a_external_count": a.get("external_count"),
        "line_a_delta": a.get("balance_delta_since_last"),
        "line_a_first_dollar": a.get("first_dollar_seen"),
        "line_b_fiat_usd": bfiat,
    }


def links(n=12) -> list:
    out = []
    led = REPO / "outreach" / "channel_post_ledger.jsonl"
    for line in reversed(_read(led).splitlines()):
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("channel") == "site" and d.get("url"):
            out.append({"type": "research", "url": d["url"], "label": (d.get("title") or d["url"])[:70],
                        "verified": d.get("result") == "ok" and bool(d.get("published")), "ts": d.get("ts", "")[:19]})
        if len(out) >= n:
            break
    # recent commits
    try:
        g = subprocess.run(["git", "-C", str(REPO), "log", "--oneline", "-8"], capture_output=True, text=True, timeout=5).stdout
        for ln in g.splitlines():
            sha, _, msg = ln.partition(" ")
            out.append({"type": "commit", "url": None, "label": f"{sha} {msg[:64]}", "verified": True, "ts": ""})
    except Exception:
        pass
    return out[:n + 8]


def crew() -> dict:
    try:
        s = subprocess.run(["python3", str(REPO / "scripts" / "crew_stage.py"), "status"],
                           capture_output=True, text=True, timeout=15, cwd=str(REPO)).stdout
        cand = (re.search(r"candidate:\s*([^\(\n]+)", s) or [None, ""])[1].strip()
        stage = (re.search(r"stage:\s*(\S+)", s) or [None, ""])[1].strip()
        return {"candidate": cand[:80], "stage": stage}
    except Exception:
        return {}


def monitor_state() -> dict:
    on = MONITOR_FLAG.exists() and _read(MONITOR_FLAG).strip() in ("", "on", "1", "true")
    feed = []
    for line in reversed(_read(MONITOR_FEED).splitlines())[:10]:
        feed.append(line[:300])
    return {"on": on, "feed": list(reversed(feed))}


def health(rt: dict, rev: dict, hist: dict) -> dict:
    # GREEN: engine alive + a pass completed recently
    green_ok = bool(rt.get("alive"))
    # SUPER-GREEN: recent builder work shipped+deployed (a commit verified) and no bare ATOM gaming
    builder_hist = hist.get("builder", [])
    shipped = any(re.search(r"\bcommit\b|deployed|SUCCESS|shipped", (e.get("did") or ""), re.I) for e in builder_hist[:3])
    atom_clean = all("none" in (e.get("atom") or "none").lower() for e in builder_hist[:3]) if builder_hist else True
    super_ok = shipped and atom_clean
    # EVER-GREEN: rhythm on tempo
    runs, rests = rt.get("runs", []), rt.get("rests", [])
    run_ok = bool(runs) and EXPECT_RUN[0] <= runs[-1] <= EXPECT_RUN[1] if runs else False
    rest_ok = bool(rests) and rests[-1] <= EXPECT_REST[1] if rests else True
    ever_ok = run_ok and rest_ok
    return {
        "green": {"ok": green_ok, "why": f"engine {'alive' if green_ok else 'DOWN'} (pid {rt.get('pid')})"},
        "super_green": {"ok": super_ok, "why": ("builder shipped+verified, ATOM clean" if super_ok
                        else "no recently-verified shipped work / or an open ATOM — ran, not competitor-grade-proven")},
        "ever_green": {"ok": ever_ok, "why": (f"on tempo (run {runs[-1] if runs else '?'}m, rest {rests[-1] if rests else '?'}m)"
                        if ever_ok else "off-tempo (run/rest outside expected band)")},
    }


def build() -> dict:
    rt = _safe(parse_routine, {})
    hist = {a: _safe(lambda a=a: agent_history(a), []) for a in AGENTS}
    now = {a: _safe(lambda a=a: agent_now(a), {}) for a in AGENTS}
    rev = _safe(revenue, {})
    state = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engine": {"alive": rt.get("alive"), "pid": rt.get("pid"), "stage": rt.get("stage"), "pass": rt.get("pass")},
        "chain": [{"stage": a, "state": ("active" if rt.get("stage") == a else "idle")} for a in AGENTS],
        "rhythm": {"runs": rt.get("runs", []), "rests": rt.get("rests", []),
                   "last_run": (rt.get("runs") or [None])[-1], "last_rest": (rt.get("rests") or [None])[-1]},
        "agents": {a: {**now.get(a, {}), "history": hist.get(a, [])} for a in AGENTS},
        "revenue": rev,
        "links": _safe(links, []),
        "crew": _safe(crew, {}),
        "monitor": _safe(monitor_state, {"on": False, "feed": []}),
    }
    state["health"] = _safe(lambda: health(rt, rev, hist), {})
    return state


def emit_sensor(state: dict):
    """Write the loop-money shared sensor so Daily Brief / self-heal see loop health."""
    h = state.get("health", {})
    alerts = [k for k, v in h.items() if not v.get("ok")]
    try:
        SENSOR.parent.mkdir(parents=True, exist_ok=True)
        SENSOR.write_text(json.dumps({
            "fetched_at": state["generated_at"],
            "status": "ok" if not alerts else "alert",
            "alert": bool(alerts),
            "summary": f"loop green={h.get('green',{}).get('ok')} super={h.get('super_green',{}).get('ok')} "
                       f"ever={h.get('ever_green',{}).get('ok')} | pass {state['engine'].get('pass')} "
                       f"stage {state['engine'].get('stage')} | A_ext=${state['revenue'].get('line_a_external_usdc')} "
                       f"B=${state['revenue'].get('line_b_fiat_usd')}",
            "health": h, "revenue": state["revenue"], "engine": state["engine"],
        }, indent=0))
    except Exception:
        pass


if __name__ == "__main__":
    st = build()
    emit_sensor(st)
    print(json.dumps(st, indent=2))
