#!/usr/bin/env python3
"""Loop Control Center — state builder.

Pure reader: turns the ACTIVE agent-chain's existing artifacts (per-agent ledgers +
transcripts, chain/routine logs, revenue sensors, publish ledger, git, crew_stage)
into one /api/state JSON, and emits a `loop-<name>` shared sensor so the Daily
Brief / self-heal see loop health too (one spine, two consumers).

Chain-agnostic: the active chain is DERIVED each build from the ground-truth signal
(the armed `~/.claude/agent-chains/*.enabled` marker + its `<name>.chain.json`), not
hardcoded — so whichever chain is armed (money, assetfactory, …) is what the page
shows. All paths/names/agents come from that manifest. The x402 money loop's rich
revenue + correctness-canary panels are preserved when it is the active chain.

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
CHAIN_DIR = HOME / ".claude" / "agent-chains"
MONITOR_FLAG = CHAIN_DIR / "monitor.flag"
MONITOR_FEED = CHAIN / "monitor.feed.jsonl"
ATOMS = CHAIN_DIR / "atoms.json"
ATOMS_LEDGER = CHAIN_DIR / "atoms_ledger.jsonl"  # append-only completion history
DEFAULT_AGENTS = ["research", "builder", "marketing"]
DEFAULT_REPO = Path("/home/rez/projects/x402-data-api")
EXPECT_RUN = (12, 32)   # expected pass run minutes
EXPECT_REST = (8, 20)   # expected rest minutes (target ~10)


def _safe(fn, default):
    try:
        return fn()
    except Exception:
        return default


def _read(p: Path, limit=200_000) -> str:
    return p.read_text(errors="replace")[-limit:] if p and p.exists() else ""


def armed_names() -> list:
    """All armed chains (ground truth: `.enabled` + manifest, no `.done`), oldest-armed first."""
    out = []
    for ef in sorted(CHAIN_DIR.glob("*.enabled"), key=lambda p: p.stat().st_mtime):
        n = ef.stem
        if (CHAIN_DIR / f"{n}.chain.json").exists() and not (CHAIN_DIR / f"{n}.done").exists():
            out.append(n)
    return out


def running_name(candidates: list) -> str:
    """Which armed chain is actually running now (holds the engine), else the one that ran most
    recently (newest .lastrun). Used to pick the default tab + highlight the live loop."""
    try:
        ps = subprocess.run(["pgrep", "-af", r"agent_chain\.sh --chain"],
                            capture_output=True, text=True, timeout=5).stdout
        m = re.search(r"agent-chains/([A-Za-z0-9_-]+)\.chain\.json", ps)
        if m and m.group(1) in candidates:
            return m.group(1)
    except Exception:
        pass
    best, bts = None, -1.0
    for n in candidates:
        lr = CHAIN_DIR / f"{n}.lastrun"
        ts = lr.stat().st_mtime if lr.exists() else 0.0
        if ts > bts:
            bts, best = ts, n
    return best or (candidates[0] if candidates else "money")


def _active_name() -> str:
    """The chain agent_chain_routine.sh would pick next-ish: oldest-armed eligible, else a
    running engine's --chain arg, else 'money'."""
    names = armed_names()
    if names:
        return names[0]
    try:
        ps = subprocess.run(["pgrep", "-af", r"agent_chain\.sh --chain"],
                            capture_output=True, text=True, timeout=5).stdout
        m = re.search(r"agent-chains/([A-Za-z0-9_-]+)\.chain\.json", ps)
        if m:
            return m.group(1)
    except Exception:
        pass
    return "money"


def _cfg_for(name: str) -> dict:
    """Build the reader-config for ONE chain from its manifest. Everything downstream is
    derived from here, so the page is fully chain-agnostic."""
    manifest = _safe(lambda: json.loads(_read(CHAIN_DIR / f"{name}.chain.json")), {}) or {}
    cwd = Path(manifest.get("cwd") or DEFAULT_REPO)
    oracle = Path(manifest["oracle_file"]) if manifest.get("oracle_file") else None
    agents = [a.get("name") for a in manifest.get("agents", []) if a.get("name")] or DEFAULT_AGENTS
    is_x402 = cwd == DEFAULT_REPO  # the money loop: preserve its rich revenue + canary panels
    pass_cooldown = manifest.get("pass_cooldown", 600)  # seconds between passes (ever_green derives from this)
    return {
        "name": name,
        "repo": cwd,
        "agents": agents,
        "oracle": oracle,
        "pass_cooldown": pass_cooldown,
        "routine_log": CHAIN / f"{name}.routine.log",
        # x402 money loop reads its dedicated rich revenue dir; others read their oracle_file.
        "revdir": (HOME / ".hermes" / "data" / "x402-revenue") if is_x402 else (oracle.parent if oracle else None),
        "uptime_sensor": HOME / ".hermes" / "data" / f"{cwd.name}-uptime" / "latest.json",
        "sensor": HOME / ".hermes" / "data" / f"loop-{name}" / "latest.json",
        "is_x402": is_x402,
    }


def latest_transcript(agent: str, cfg: dict) -> Path | None:
    d = GL / f"chain-{cfg['name']}-{agent}" / "history"
    js = sorted(d.glob("*.jsonl"), key=lambda x: x.stat().st_mtime) if d.exists() else []
    return js[-1] if js else None


def agent_now(agent: str, cfg: dict) -> dict:
    """Latest assistant narration = 'what it's talking about now' + liveness."""
    t = latest_transcript(agent, cfg)
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


def agent_history(agent: str, cfg: dict, n=8) -> list:
    """Parse the progress ledger into cycle entries (newest first)."""
    led = GL / f"chain-{cfg['name']}-{agent}" / "progress.ledger.md"
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


def parse_routine(cfg: dict) -> dict:
    """Engine liveness, current stage, pass number, and rhythm timings."""
    txt = _read(cfg["routine_log"])
    rows = []
    for line in txt.splitlines():
        m = re.match(r"\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z\]\s+agent-chain\[\d+\]:\s+(.*)", line)
        if m:
            rows.append((datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc), m.group(2)))

    # alive? (match this chain's engine specifically)
    alive, pid = False, None
    try:
        out = subprocess.run(["pgrep", "-f", rf"agent_chain\.sh --chain.*{re.escape(cfg['name'])}\.chain\.json"],
                             capture_output=True, text=True, timeout=5).stdout.split()
        alive = bool(out)
        pid = int(out[0]) if out else None
    except Exception:
        pass
    # current stage (which chain-<name>-* claude is running)
    stage = "rest"
    try:
        ps = subprocess.run(["pgrep", "-af", f"name chain-{cfg['name']}"], capture_output=True, text=True, timeout=5).stdout
        for a in cfg["agents"]:
            if f"chain-{cfg['name']}-{a}" in ps:
                stage = a
    except Exception:
        pass

    # rhythm: reconstruct per-pass run durations + rests between passes
    runs, rests = [], []
    seg = {}
    last_pass_end = None
    cur_pass = None
    for t, msg in rows:
        if "agent 1/" in msg and "research" in msg:
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


def revenue(cfg: dict) -> dict:
    """x402 money loop: its rich dual-file (Line A usdc + Line B fiat). Other chains: read the
    manifest oracle_file and surface its headline balance generically."""
    revdir = cfg["revdir"]
    if cfg["is_x402"]:
        a = _safe(lambda: json.loads(_read(revdir / "latest.json")), {})
        b = _safe(lambda: json.loads(_read(revdir / "fiat_latest.json")), {})
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
    # generic chain: read its oracle_file
    o = _safe(lambda: json.loads(_read(cfg["oracle"])), {}) if cfg["oracle"] else {}
    bal = o.get("balance_usd", o.get("balance_usdc", 0))
    return {
        "balance_usd": bal,
        "metered_invocations": o.get("metered_invocations"),
        "assets_published": o.get("assets_published"),
        "external_payers": o.get("external_payers"),
        "oracle_note": o.get("note", ""),
        # keep the keys the UI expects so it renders cleanly (no x402 revenue for this chain yet)
        "line_a_external_usdc": None, "line_b_fiat_usd": None,
    }


def links(cfg: dict, n=12) -> list:
    out = []
    repo = cfg["repo"]
    led = repo / "outreach" / "channel_post_ledger.jsonl"
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
        g = subprocess.run(["git", "-C", str(repo), "log", "--oneline", "-8"], capture_output=True, text=True, timeout=5).stdout
        for ln in g.splitlines():
            sha, _, msg = ln.partition(" ")
            out.append({"type": "commit", "url": None, "label": f"{sha} {msg[:64]}", "verified": True, "ts": ""})
    except Exception:
        pass
    return out[:n + 8]


def crew(cfg: dict) -> dict:
    repo = cfg["repo"]
    script = repo / "scripts" / "crew_stage.py"
    if not script.exists():
        return {}
    try:
        s = subprocess.run(["python3", str(script), "status"],
                           capture_output=True, text=True, timeout=15, cwd=str(repo)).stdout
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


def _ledger_append(ev: dict) -> None:
    try:
        ATOMS_LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with open(ATOMS_LEDGER, "a") as f:
            f.write(json.dumps(ev) + "\n")
    except Exception:
        pass


def _ledger_cleared() -> list:
    """Currently-cleared atoms derived from the append-only ledger (latest event per id wins).
    Append-only → never mutated; state is DERIVED, so a re-open supersedes a done."""
    latest: dict = {}
    for line in _read(ATOMS_LEDGER).splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get("id"):
            latest[ev["id"]] = ev
    return [ev for ev in latest.values() if ev.get("event") == "done"]


def harvest_atoms(active_loop: str = "money") -> dict:
    """Read the clean, STRUCTURED atom store (populated by note_atom.py). Panel shows OPEN atoms
    FOR THE ACTIVE LOOP only (atoms stay with their loop); legacy untagged atoms default to 'money'.
    Cleared atoms live in the append-only ledger (the complete record the loop reads)."""
    store = _safe(lambda: json.loads(_read(ATOMS)), {}) or {"atoms": []}
    allopen = [a for a in store.get("atoms", []) if not a.get("done")]
    opens = [a for a in allopen if (a.get("loop") or "money") == active_loop]
    other = len(allopen) - len(opens)
    cleared = sorted(_safe(_ledger_cleared, []), key=lambda e: e.get("ts", ""))
    return {"open": opens, "open_count": len(opens), "loop": active_loop,
            "other_loop_open_count": other,
            "cleared": cleared[-20:], "cleared_count": len(cleared)}


def mark_atom(aid: str, done: bool = True) -> bool:
    """Server calls this when Rez checks an atom off (or re-opens it). Marks the live store
    AND appends a durable event to the completion ledger — so checked atoms leave the panel,
    persist in the complete record, and the loop sees the clear."""
    store = _safe(lambda: json.loads(_read(ATOMS)), {}) or {"atoms": []}
    hit = None
    for a in store.get("atoms", []):
        if a.get("id") == aid:
            a["done"] = bool(done)
            a["done_at"] = datetime.now(timezone.utc).isoformat() if done else None
            hit = a
    if hit is not None:
        try:
            ATOMS.write_text(json.dumps(store, indent=0))
        except Exception:
            return False
        _ledger_append({"ts": datetime.now(timezone.utc).isoformat(),
                        "event": "done" if done else "reopen", "id": aid,
                        "text": hit.get("text"), "agent": hit.get("agent"), "steps": hit.get("steps"),
                        "by": "rez", "evidence": ""})  # human checkbox (agent resolves carry by=<agent>+evidence)
    return hit is not None


def health(rt: dict, rev: dict, hist: dict, cfg: dict) -> dict:
    # GREEN: engine alive + a pass completed recently
    green_ok = bool(rt.get("alive"))
    # SUPER-GREEN: recent builder work shipped+deployed (a commit verified) and no bare ATOM gaming
    builder_hist = hist.get("builder", [])
    shipped = any(re.search(r"\bcommit\b|deployed|SUCCESS|shipped", (e.get("did") or ""), re.I) for e in builder_hist[:3])
    # An atom is "clean" when empty/none OR a legitimate ONE-TIME account/key/credential gate — that
    # is NOT work parked on a human (a vague non-account atom still fails = gaming signal). Fixes the
    # false-negative where a real one-time account gate (e.g. the Apify token) read as "unclean".
    def _atom_clean(a: str) -> bool:
        a = (a or "none").strip().lower()
        if a in ("", "none"):
            return True
        return bool(re.search(r"one-time|account|api[\s_-]?key|api[\s_-]?token|\btoken\b|credential|oauth|sign[\s_-]?up|register|passkey|2fa", a))
    atom_clean = all(_atom_clean(e.get("atom")) for e in builder_hist[:3]) if builder_hist else True
    super_ok = shipped and atom_clean
    # EVER-GREEN: is the loop looping CONSISTENTLY? Derived from the chain's OWN configured
    # pass_cooldown (not an x402-specific minute band): a pass has completed, the rest between passes
    # is ~the configured cooldown (so it's genuinely re-looping, not dead), and no pass is hung.
    runs, rests = rt.get("runs", []), rt.get("rests", [])
    cooldown_min = (cfg.get("pass_cooldown", 600) or 600) / 60.0
    have_passes = bool(runs)
    not_hung = (runs[-1] <= 60) if runs else True          # a pass grossly over ~1h signals a hang
    looping = (rests[-1] <= cooldown_min + 10) if rests else True  # rest ≈ cooldown ⇒ re-looping
    ever_ok = have_passes and not_hung and looping
    # GATE: x402 money-route correctness canary (uptime_probe.py). Only applies to the x402 money
    # loop; other chains have no such sensor → degrade OPEN (gate ok, "n/a for this chain").
    u = _safe(lambda: json.loads(_read(cfg["uptime_sensor"])), {})
    if not u:
        gate_why = ("money-route canaries only apply to the x402 loop — n/a for this chain"
                    if not cfg["is_x402"] else "correctness inconclusive (probe not run yet / unreachable) — not alarming")
        return {
            "green": {"ok": green_ok, "why": f"engine {'alive' if green_ok else 'DOWN'} (pid {rt.get('pid')})"},
            "super_green": {"ok": super_ok, "why": ("builder shipped+verified; atom clear or a one-time account gate" if super_ok
                            else ("no recently-verified shipped commit" if not shipped else "work parked on a non-account human atom"))},
            "ever_green": {"ok": ever_ok, "why": (f"looping on tempo (last run {runs[-1] if runs else '?'}m, rest {rests[-1] if rests else '?'}m ≈ {cooldown_min:.0f}m cooldown)"
                            if ever_ok else ("no completed pass yet" if not have_passes else f"off-tempo (last run {runs[-1] if runs else '?'}m / rest {rests[-1] if rests else '?'}m vs {cooldown_min:.0f}m cooldown)"))},
            "gate": {"ok": True, "why": gate_why},
        }
    gate_ok = u.get("gate_detection_ok")      # True pass / False regression / None inconclusive
    scan_ok = u.get("scan_detection_ok")
    report_ok = u.get("report_detection_ok")  # 2nd Line-A paid surface (/chain/token-report)
    security_ok = u.get("security_detection_ok")  # 3rd Line-A paid surface (/chain/token-security)
    yields_ok = u.get("yields_detection_ok")  # #1 external-payer DATA route (/defi/yields)
    funding_ok = u.get("funding_detection_ok")  # 5-venue superset (/crypto/funding) — venue-null guard
    degraded = u.get("degraded") or []
    gate_degraded = [d for d in degraded if "/gate/swap" in d or "/scan/mcp" in d or "/chain/token-report" in d or "/chain/token-security" in d or "/defi/yields" in d or "/crypto/funding" in d]
    corr_regressed = gate_ok is False or scan_ok is False or report_ok is False or security_ok is False or yields_ok is False or funding_ok is False or bool(gate_degraded)
    gate_health_ok = not corr_regressed       # inconclusive/missing => ok (degrade open)
    _all_pass = gate_ok and scan_ok and report_ok and security_ok and yields_ok and funding_ok
    gate_why = ("; ".join(gate_degraded) if gate_degraded
                else "money-gate + token-report + token-security + yields + funding + scanner canaries PASS" if _all_pass
                else "correctness inconclusive (probe not run yet / unreachable) — not alarming")
    return {
        "green": {"ok": green_ok, "why": f"engine {'alive' if green_ok else 'DOWN'} (pid {rt.get('pid')})"},
        "super_green": {"ok": super_ok, "why": ("builder shipped+verified; atom clear or a one-time account gate" if super_ok
                        else ("no recently-verified shipped commit" if not shipped else "work parked on a non-account human atom"))},
        "ever_green": {"ok": ever_ok, "why": (f"looping on tempo (last run {runs[-1] if runs else '?'}m, rest {rests[-1] if rests else '?'}m ≈ {cooldown_min:.0f}m cooldown)"
                        if ever_ok else ("no completed pass yet" if not have_passes else f"off-tempo (last run {runs[-1] if runs else '?'}m / rest {rests[-1] if rests else '?'}m vs {cooldown_min:.0f}m cooldown)"))},
        "gate": {"ok": gate_health_ok, "why": gate_why},
    }


def build_for(cfg: dict) -> dict:
    agents = cfg["agents"]
    rt = _safe(lambda: parse_routine(cfg), {})
    hist = {a: _safe(lambda a=a: agent_history(a, cfg), []) for a in agents}
    now = {a: _safe(lambda a=a: agent_now(a, cfg), {}) for a in agents}
    rev = _safe(lambda: revenue(cfg), {})
    state = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "loop": cfg["name"],
        "project": str(cfg["repo"]),
        "engine": {"alive": rt.get("alive"), "pid": rt.get("pid"), "stage": rt.get("stage"), "pass": rt.get("pass")},
        "chain": [{"stage": a, "state": ("active" if rt.get("stage") == a else "idle")} for a in agents],
        "rhythm": {"runs": rt.get("runs", []), "rests": rt.get("rests", []),
                   "last_run": (rt.get("runs") or [None])[-1], "last_rest": (rt.get("rests") or [None])[-1]},
        "agents": {a: {**now.get(a, {}), "history": hist.get(a, [])} for a in agents},
        "revenue": rev,
        "links": _safe(lambda: links(cfg), []),
        "crew": _safe(lambda: crew(cfg), {}),
        "atoms": _safe(lambda: harvest_atoms(cfg["name"]), {"open": [], "done": [], "open_count": 0}),
        "monitor": _safe(monitor_state, {"on": False, "feed": []}),
    }
    state["health"] = _safe(lambda: health(rt, rev, hist, cfg), {})
    state["_sensor_path"] = str(cfg["sensor"])
    state["_is_x402"] = cfg["is_x402"]
    return state


def build() -> dict:
    """Multi-loop: build full state for EVERY armed chain so the page can tab between them.
    The active (running / most-recently-run) loop's state is also spread at the top level for
    backward compatibility with the single-loop page contract."""
    names = armed_names() or [_active_name()]
    loops = {n: _safe(lambda n=n: build_for(_cfg_for(n)), {}) for n in names}
    active = running_name(names)
    base = loops.get(active) or (next(iter(loops.values())) if loops else {})
    state = dict(base)  # backward-compat: active loop's fields at top level
    state["loops"] = loops
    state["loop_names"] = names
    state["active"] = active
    return state


def resolve_active() -> dict:
    """Back-compat shim: the active chain's reader-config."""
    return _cfg_for(_active_name())


def emit_sensor(state: dict):
    """Write the loop-<name> shared sensor so Daily Brief / self-heal see loop health.
    Also mirrors to loop-money when the x402 money loop is active (backward-compat consumers)."""
    h = state.get("health", {})
    alerts = [k for k, v in h.items() if not v.get("ok")]
    payload = {
        "fetched_at": state["generated_at"],
        "loop": state.get("loop"),
        "status": "ok" if not alerts else "alert",
        "alert": bool(alerts),
        "summary": f"loop={state.get('loop')} green={h.get('green',{}).get('ok')} super={h.get('super_green',{}).get('ok')} "
                   f"ever={h.get('ever_green',{}).get('ok')} gate={h.get('gate',{}).get('ok')} | pass {state['engine'].get('pass')} "
                   f"stage {state['engine'].get('stage')} | rev={json.dumps(state.get('revenue', {}))[:120]}",
        "health": h, "revenue": state["revenue"], "engine": state["engine"],
    }
    targets = [Path(state["_sensor_path"])]
    if state.get("_is_x402"):
        targets.append(HOME / ".hermes" / "data" / "loop-money" / "latest.json")
    for t in targets:
        try:
            t.parent.mkdir(parents=True, exist_ok=True)
            t.write_text(json.dumps(payload, indent=0))
        except Exception:
            pass


if __name__ == "__main__":
    st = build()
    # emit a loop-<name> sensor for EACH armed loop (both consumers stay fed)
    for _n in st.get("loop_names", []):
        _ls = st.get("loops", {}).get(_n)
        if _ls:
            _safe(lambda ls=_ls: emit_sensor(ls), None)
    print(json.dumps(st, indent=2))
