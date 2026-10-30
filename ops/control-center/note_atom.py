#!/usr/bin/env python3
"""Record a clean Rez-atom (an account/identity gate) into the checkable store.

Agents call this instead of burying an atom in ledger prose:
    python3 ops/control-center/note_atom.py "Publish the ElizaOS plugin: cd integrations/... && npm publish" builder

Dedupes by normalized text so the same atom logged every cycle = one entry. The
console reads the store and lets Rez check it off. No prose scraping = no fragments.
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ATOMS = Path.home() / ".claude" / "agent-chains" / "atoms.json"
ATOMS_LEDGER = Path.home() / ".claude" / "agent-chains" / "atoms_ledger.jsonl"  # append-only clear/reopen history
CHAIN_DIR = Path.home() / ".claude" / "agent-chains"


def _active_loop() -> str:
    """Which loop owns a new atom = the currently-armed chain (ground truth), so atoms stay with
    their loop and never get mixed. Order: explicit $GREYRIDGE_LOOP → oldest-armed *.enabled chain
    → 'money' (legacy default). Mirrors agent_chain_routine.sh / the dashboard's resolve."""
    env = os.environ.get("GREYRIDGE_LOOP", "").strip()
    if env:
        return env
    try:
        enabled = sorted(CHAIN_DIR.glob("*.enabled"), key=lambda p: p.stat().st_mtime)
        for ef in enabled:
            n = ef.stem
            if (CHAIN_DIR / f"{n}.chain.json").exists() and not (CHAIN_DIR / f"{n}.done").exists():
                return n
    except Exception:
        pass
    return "money"


def add(text: str, agent: str = "agent", steps: list[str] | None = None) -> str | None:
    text = re.sub(r"\s+", " ", text).strip(" .;")
    if len(text) < 8:
        return None
    steps = [s.strip() for s in (steps or []) if s.strip()]
    aid = hashlib.sha1(text.lower().encode()).hexdigest()[:10]
    store = json.loads(ATOMS.read_text()) if ATOMS.exists() else {"atoms": []}
    loop = _active_loop()  # stamp the owning loop so atoms stay with their loop
    for a in store["atoms"]:
        if a["id"] == aid:
            # already tracked — enrich with steps / loop if missing
            changed = False
            if steps and not a.get("steps"):
                a["steps"] = steps
                changed = True
            if not a.get("loop"):
                a["loop"] = loop
                changed = True
            if changed:
                ATOMS.write_text(json.dumps(store, indent=0))
            return aid
    # FUZZY-DEDUP: the loop re-raises the SAME ask with reworded text (new exact hash),
    # which piled up ~12 npm-token / 3 PyPI near-duplicate atoms. Before appending, if an
    # OPEN atom of this loop strongly overlaps on significant tokens, treat it as the same
    # ask: enrich + return it instead of adding a near-dup. Thresholds are conservative
    # (mutual coverage) so genuinely distinct atoms (x402scan vs HOL registry) stay separate.
    def _sig(t: str) -> set:
        t = re.sub(r"\([^)]*\)", " ", (t or "").lower())
        stop = {"that", "this", "with", "from", "your", "once", "needs", "need", "into",
                "they", "them", "loop", "grey", "ridge", "will", "make", "makes", "already",
                "pushed", "done", "ready", "creates", "create", "so", "the", "and", "for"}
        return {w for w in re.findall(r"[a-z0-9@._/+-]{4,}", t) if w not in stop}
    nsig = _sig(text)
    if nsig:
        for a in store["atoms"]:
            if a.get("done") or (a.get("loop") or loop) != loop:
                continue
            esig = _sig(a.get("text", ""))
            if not esig:
                continue
            inter = len(nsig & esig)
            if inter / len(nsig) >= 0.7 and inter / len(esig) >= 0.6:
                if steps and not a.get("steps"):
                    a["steps"] = steps
                    ATOMS.write_text(json.dumps(store, indent=0))
                return a["id"]  # same ask already open — suppress the near-duplicate
    store["atoms"].append({"id": aid, "text": text[:260], "agent": agent, "steps": steps, "loop": loop,
                           "first_seen": datetime.now(timezone.utc).isoformat(), "done": False, "done_at": None})
    ATOMS.parent.mkdir(parents=True, exist_ok=True)
    ATOMS.write_text(json.dumps(store, indent=0))
    return aid


def set_steps(aid: str, steps: list[str]) -> bool:
    """Attach / replace the how-to steps on an existing atom by id."""
    steps = [s.strip() for s in steps if s.strip()]
    store = json.loads(ATOMS.read_text()) if ATOMS.exists() else {"atoms": []}
    for a in store["atoms"]:
        if a["id"] == aid:
            a["steps"] = steps
            ATOMS.write_text(json.dumps(store, indent=0))
            return True
    return False


def _load():
    return json.loads(ATOMS.read_text()) if ATOMS.exists() else {"atoms": []}


def _ledger_append(ev: dict) -> None:
    try:
        ATOMS_LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with open(ATOMS_LEDGER, "a") as f:
            f.write(json.dumps(ev) + "\n")
    except Exception:
        pass


def resolve_atom(aid: str, agent: str, evidence: str) -> bool:
    """An AGENT marks a blocker it completed as done — attributed + evidenced (never a
    bare claim). Writes the store AND a ledger event carrying who resolved it + proof,
    so the console shows agent-resolved atoms distinctly and Rez can audit them."""
    from datetime import datetime, timezone
    evidence = (evidence or "").strip()
    if not evidence:
        return False  # evidence is mandatory — no self-attestation without proof
    store = json.loads(ATOMS.read_text()) if ATOMS.exists() else {"atoms": []}
    for a in store.get("atoms", []):
        if a["id"] == aid:
            now = datetime.now(timezone.utc).isoformat()
            a["done"] = True
            a["done_at"] = now
            a["resolved_by"] = agent
            a["evidence"] = evidence[:400]
            ATOMS.write_text(json.dumps(store, indent=0))
            _ledger_append({"ts": now, "event": "done", "id": aid, "text": a.get("text"),
                            "agent": a.get("agent"), "by": agent, "evidence": evidence[:400]})
            return True
    return False


def _ledger_cleared():
    """Cleared gates derived from the append-only ledger (latest event per id wins).
    This is what the loop reads — the complete, durable record, not the lean live store."""
    latest = {}
    if ATOMS_LEDGER.exists():
        for line in ATOMS_LEDGER.read_text().splitlines():
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


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage:\n"
              "  note_atom.py '<atom>' [agent] ['<step1>' '<step2>' ...]   # log (steps optional)\n"
              "  note_atom.py set-steps <id> '<step1>' '<step2>' ...        # attach how-to to existing atom\n"
              "  note_atom.py done | open")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "done":
        # cleared gates Rez checked off — read from the append-only ledger (the durable record)
        for ev in sorted(_ledger_cleared(), key=lambda e: e.get("ts", "")):
            print(f"[CLEARED {ev.get('ts','')[:19]}] {ev.get('text','')}")
    elif cmd == "open":
        # optional loop filter: `note_atom.py open assetfactory` shows only that loop's atoms
        want = sys.argv[2] if len(sys.argv) > 2 else None
        for a in _load().get("atoms", []):
            if a.get("done"):
                continue
            lp = a.get("loop", "?")
            if want and lp != want:
                continue
            tag = " (+steps)" if a.get("steps") else ""
            print(f"[OPEN·{lp}] {a['text']}{tag}")
    elif cmd == "resolve":
        # an AGENT checks off a blocker it completed — attributed + evidence-gated
        if len(sys.argv) < 5:
            print("usage: note_atom.py resolve <id> <agent> '<evidence: url/commit/verify-output>'")
            sys.exit(1)
        ok = resolve_atom(sys.argv[2], sys.argv[3], sys.argv[4])
        print("resolved" if ok else "(no such atom id, or evidence empty — evidence is required)")
    elif cmd == "set-steps":
        if len(sys.argv) < 4:
            print("usage: note_atom.py set-steps <id> '<step1>' '<step2>' ...")
            sys.exit(1)
        print("ok" if set_steps(sys.argv[2], sys.argv[3:]) else "(no such atom id)")
    else:
        # positional: text, [agent], [steps...]
        agent = sys.argv[2] if len(sys.argv) > 2 else "agent"
        steps = sys.argv[3:] if len(sys.argv) > 3 else None
        print(add(cmd, agent, steps) or "(skipped)")
