#!/usr/bin/env python3
"""Record a clean Rez-atom (an account/identity gate) into the checkable store.

Agents call this instead of burying an atom in ledger prose:
    python3 ops/control-center/note_atom.py "Publish the ElizaOS plugin: cd integrations/... && npm publish" builder

Dedupes by normalized text so the same atom logged every cycle = one entry. The
console reads the store and lets Rez check it off. No prose scraping = no fragments.
"""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ATOMS = Path.home() / ".claude" / "agent-chains" / "atoms.json"


def add(text: str, agent: str = "agent", steps: list[str] | None = None) -> str | None:
    text = re.sub(r"\s+", " ", text).strip(" .;")
    if len(text) < 8:
        return None
    steps = [s.strip() for s in (steps or []) if s.strip()]
    aid = hashlib.sha1(text.lower().encode()).hexdigest()[:10]
    store = json.loads(ATOMS.read_text()) if ATOMS.exists() else {"atoms": []}
    for a in store["atoms"]:
        if a["id"] == aid:
            # already tracked — enrich with steps if it had none and we now have them
            if steps and not a.get("steps"):
                a["steps"] = steps
                ATOMS.write_text(json.dumps(store, indent=0))
            return aid
    store["atoms"].append({"id": aid, "text": text[:260], "agent": agent, "steps": steps,
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


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage:\n"
              "  note_atom.py '<atom>' [agent] ['<step1>' '<step2>' ...]   # log (steps optional)\n"
              "  note_atom.py set-steps <id> '<step1>' '<step2>' ...        # attach how-to to existing atom\n"
              "  note_atom.py done | open")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "done":
        # cleared gates Rez has checked off — the loop reads these to know a gate is UNBLOCKED
        for a in _load().get("atoms", []):
            if a.get("done"):
                print(f"[CLEARED {a.get('done_at','')[:19]}] {a['text']}")
    elif cmd == "open":
        for a in _load().get("atoms", []):
            if not a.get("done"):
                tag = " (+steps)" if a.get("steps") else ""
                print(f"[OPEN] {a['text']}{tag}")
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
