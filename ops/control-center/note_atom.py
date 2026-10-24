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


def add(text: str, agent: str = "agent") -> str | None:
    text = re.sub(r"\s+", " ", text).strip(" .;")
    if len(text) < 8:
        return None
    aid = hashlib.sha1(text.lower().encode()).hexdigest()[:10]
    store = json.loads(ATOMS.read_text()) if ATOMS.exists() else {"atoms": []}
    if any(a["id"] == aid for a in store["atoms"]):
        return aid  # already tracked
    store["atoms"].append({"id": aid, "text": text[:260], "agent": agent,
                           "first_seen": datetime.now(timezone.utc).isoformat(), "done": False, "done_at": None})
    ATOMS.parent.mkdir(parents=True, exist_ok=True)
    ATOMS.write_text(json.dumps(store, indent=0))
    return aid


def _load():
    return json.loads(ATOMS.read_text()) if ATOMS.exists() else {"atoms": []}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: note_atom.py '<atom>' [agent]   |   note_atom.py done   |   note_atom.py open")
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
                print(f"[OPEN] {a['text']}")
    else:
        print(add(cmd, sys.argv[2] if len(sys.argv) > 2 else "agent") or "(skipped)")
