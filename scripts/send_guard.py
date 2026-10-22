#!/usr/bin/env python3
"""send_guard.py — pre-send gate for prospect outreach. The money loop MUST run this
before emailing or commenting at any prospect, and obey a BLOCK.

Why this exists (2026-10-21): the loop sent a generic "following up" to a warm lead
(Miles / LiquidLogicX) who was mid-evaluation with an agreed quiet window — over-contact
that risks the warmest lead. The warm-thread *sensor* already knew not to nudge, but the
loop emails via the gmail MCP tool, bypassing it. This is the forcing function at the
decision point: ask the ledger, obey the answer.

Ground truth = outreach/warm_leads.json (the same ledger the loop maintains). A recipient
is BLOCKED when it matches a tracked warm lead whose agreed quiet window
(do_not_send_until) has NOT yet passed — regardless of who spoke last. A genuine REPLY to
something they just sent is allowed with --reply (their inbound reopens the conversation);
an unsolicited nudge during the quiet window is not.

Matching is by data, not a hardcoded roster: --to <email> is matched against each lead's
`emails` list; --thread <id> against `thread_id`; --lead <substr> against `lead`. Add an
`emails` array to an email-channel lead in warm_leads.json to make it matchable (config,
editable without a code change).

Degrades OPEN: if the ledger is missing/unreadable or nothing matches, ALLOW (exit 0) —
this guard narrows over-contact, it must never silently block all outreach.

Exit 0 = ALLOW (prints ALLOW + reason). Exit 10 = BLOCK (prints BLOCK + reason + the lead
and its do_not_send_until). Any internal error => ALLOW (fail-open), reason noted on stderr.
"""
import argparse
import datetime
import json
import os
import sys

LEDGER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "outreach", "warm_leads.json")


def _parse_dt(s):
    if not s:
        return None
    s = s.strip()
    if len(s) == 10:  # bare date => start of that UTC day
        s = s + "T00:00:00+00:00"
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _match(lead, to, thread, lead_sub):
    emails = [e.lower() for e in (lead.get("emails") or []) if e]
    if to and to.lower() in emails:
        return True
    if thread and lead.get("thread_id") and thread.strip() == str(lead.get("thread_id")).strip():
        return True
    if lead_sub and lead_sub.lower() in str(lead.get("lead", "")).lower():
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", default="", help="recipient email")
    ap.add_argument("--thread", default="", help="thread id (gmail thread or owner/repo#n)")
    ap.add_argument("--lead", default="", help="substring of a lead name")
    ap.add_argument("--reply", action="store_true",
                    help="this send is a direct reply to a message they just sent (reopens the window)")
    ap.add_argument("--ledger", default=LEDGER,
                    help="warm-lead ledger path (override for tests)")
    a = ap.parse_args()

    if not (a.to or a.thread or a.lead):
        print("ALLOW: no recipient given to check (degrade-open)")
        return 0
    if a.reply:
        print("ALLOW: marked as a reply to their inbound — their message reopens the conversation")
        return 0

    if not os.path.exists(a.ledger):
        # No ledger yet is a benign first-run state — stay quietly open.
        print("ALLOW: no warm-lead ledger yet (degrade-open)")
        return 0
    try:
        data = json.load(open(a.ledger))
    except Exception as e:
        # The ledger EXISTS but is corrupt — this disables the guard, so make it LOUD
        # (an operator/harness must notice) while still degrading open so one broken
        # file never blocks all outreach.
        print(f"WARN: warm-lead ledger is corrupt ({type(e).__name__}: {e}) — guard is "
              f"DISABLED until {a.ledger} is repaired; validate with: python3 -m json.tool {a.ledger}",
              file=sys.stderr)
        print("ALLOW: warm-lead ledger corrupt (degrade-open; see WARN on stderr)")
        return 0

    now = datetime.datetime.now(datetime.timezone.utc)
    for lead in data.get("leads", []):
        if not _match(lead, a.to, a.thread, a.lead):
            continue
        dns = _parse_dt(lead.get("do_not_send_until"))
        if dns is not None and now < dns:
            print(f"BLOCK: '{lead.get('lead')}' is in an agreed quiet window until "
                  f"{lead.get('do_not_send_until')} (status={lead.get('status')}). "
                  f"Do NOT send an unsolicited nudge. If they just replied, re-run with --reply.")
            return 10
        print(f"ALLOW: '{lead.get('lead')}' matched; quiet window passed "
              f"(do_not_send_until={lead.get('do_not_send_until')}).")
        return 0

    print("ALLOW: recipient is not a tracked warm lead (degrade-open)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
