#!/usr/bin/env python3
"""Backfill a per-prospect outreach ledger in outreach/sent/.

The goal-gate counts `contacted` as the number of per-prospect files in
outreach/sent/ (excluding .log/.txt/.json). Historically most pitches were
posted as GitHub issues (bodies live in outreach/gh/, URLs in _pitched.txt)
but never written back as per-prospect sent records, so `contacted` read 15
while 35+ distinct prospects actually replied. That made the gate's funnel
math impossible (contacted < replied) and forced it to emit the false
"do first outreach" every cycle instead of naming the true leak (replied->paid).

This script rebuilds the ledger from EVIDENCE-backed sources only:
  1. issue_replies sensor  -> every URL that replied is proof we contacted it.
  2. outreach/_pitched.txt  -> URLs/slugs we recorded as pitched.
Each distinct prospect gets one outreach/sent/<slug>.md stub recording the
source and date. Idempotent: existing records are left untouched.

Run:  python3 -I scripts/backfill_outreach_ledger.py
"""
import datetime
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SENT = os.path.join(REPO, "outreach", "sent")
REPLIES = os.path.expanduser("~/.hermes/data/x402_issue_replies/latest.json")
PITCHED = os.path.join(REPO, "outreach", "_pitched.txt")

def slug_from_url(u):
    m = re.search(r"github\.com/([^/]+)/([^/]+)/(?:issues|pull)/(\d+)", u)
    if m:
        return f"gh-{m.group(1)}-{m.group(2)}-{m.group(3)}".lower()
    m = re.search(r"github\.com/([^/]+)/([^/]+)", u)
    if m:
        return f"gh-{m.group(1)}-{m.group(2)}".lower()
    m = re.search(r"https?://([^/]+)", u)
    if m:
        return "web-" + re.sub(r"[^a-z0-9]+", "-", m.group(1).lower()).strip("-")
    return None

def main():
    os.makedirs(SENT, exist_ok=True)
    prospects = {}  # slug -> (url, source)

    # 1. replied issues = proof of contact
    try:
        reps = json.load(open(REPLIES))
        for r in reps.get("replies", []):
            u = r.get("url")
            if not u:
                continue
            s = slug_from_url(u)
            if s and s not in prospects:
                prospects[s] = (u, "reply-received (proof of contact)")
    except Exception as e:
        print(f"warn: replies sensor unreadable: {e}", file=sys.stderr)

    # 2. pitched log
    try:
        for tok in open(PITCHED).read().split():
            if tok.startswith("http"):
                s = slug_from_url(tok)
                if s and s not in prospects:
                    prospects[s] = (tok, "pitched (_pitched.txt)")
    except Exception as e:
        print(f"warn: _pitched.txt unreadable: {e}", file=sys.stderr)

    today = datetime.date.today().isoformat()
    written = 0
    for s, (url, src) in sorted(prospects.items()):
        path = os.path.join(SENT, f"{s}.md")
        if os.path.exists(path):
            continue
        with open(path, "w") as fh:
            fh.write(f"# outreach: {s}\n\n")
            fh.write(f"- url: {url}\n")
            fh.write(f"- source: {src}\n")
            fh.write(f"- ledger-backfilled: {today}\n")
        written += 1

    existing = len([x for x in os.listdir(SENT)
                    if not x.endswith((".log", ".txt", ".json"))])
    print(f"prospects(evidence-backed)={len(prospects)} new_records={written} "
          f"ledger_total={existing}")

if __name__ == "__main__":
    main()
