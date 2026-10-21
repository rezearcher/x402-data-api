#!/usr/bin/env python3
"""
classify_replies.py — turn the raw pitch-reply sensor into an HONEST conversion funnel.

Problem it solves: the goal-gate reads `replied = N distinct users` and routes the
cycle to "convert a reply". But most of those replies are *rejections*, *reciprocal
sellers pitching us back*, or *bot/CI noise* — not demand. So the gate over-states the
convertible pool and sends cycle after cycle chasing dead threads.

This classifies every reply by SIGNALS IN THE BODY (never a hardcoded roster of
usernames — per the no-hardcoded-list-as-logic rule), dedups to the most-decisive reply
per thread, and emits the true counts + the short list of genuinely convertible threads
with names/URLs. Degrades OPEN: anything that matches no rule lands in `needs-review`,
never silently dropped.

Reads : ~/.hermes/data/x402_issue_replies/latest.json   (the reply sensor)
Writes: ~/.hermes/data/x402_reply_funnel/latest.json     (shared sensor, for the gate/next cycle)
Prints: human scoreboard to stdout.

Run:  python3 -I scripts/classify_replies.py
"""
import json
import os
import re
import sys
import datetime
import pathlib

SENSOR_IN = os.path.expanduser("~/.hermes/data/x402_issue_replies/latest.json")
SENSOR_OUT_DIR = os.path.expanduser("~/.hermes/data/x402_reply_funnel")

# --- signal vocabularies (lower-cased substring match on the reply body) ---------
# Each list is DATA, editable without touching logic, and the classifier records WHICH
# signal fired so a wrong call is auditable rather than silent.

BOT_USER = re.compile(r"(\[bot\]|bot$)", re.I)
BOT_BODY = [
    "coderabbit", "attempting to deploy", "vercel", "glama-check", "url-check",
    "auth-check", "projects-md", "jev pull request", "stale because", "a maintainer will",
    "thanks for opening your first issue", "listing requirements",
]

# Explicit rejection / closure language.
CLOSED = [
    "closing", "closed for now", "closing this", "we won't", "won't be taking",
    "won't list", "won't wire", "not planning", "not considering", "isn't something",
    "out of scope", "not a fit", "isn't a fit", "decided to remove", "removing the",
    "we don't integrate", "we do not", "don't plan to add", "not the right recipient",
    "not enough on its own", "not in our roadmap", "cannot add", "we can't",
    "so i'm closing", "so we will close", "so closing",
    "no p0/p1", "closing as", "won't send", "we won't send",
    "going to close", "isn't enough", "isn't a fit for", "does not take",
    "not something i'm looking to add", "we are not considering", "stays dependency-free",
    "won't take", "not taking", "not a report about code", "doesn't apply",
]

# Their own chain is NOT Base -> our Base-only gate can't serve them.
WRONG_CHAIN = ["robinhood chain", "bnb chain", "bnb", "solana", "near", "xrp ledger",
               "xrp", "stellar", "hedera", "focused on bnb", "arc chain"]

# They replied by pitching THEIR OWN product (a peer seller, not a buyer).
RECIPROCAL = ["sluzen settles", "saferouter", "we built this", "we shipped it",
              "we already operate", "we already ship", "our own", "vytrel",
              "second live base x402", "can be used alongside", "scoped to"]

# Genuine positive / buying intent.
POSITIVE = ["good fit", "interesting shape", "i'll look into", "ill look into",
            "we'll take you up", "we’ll take you up", "run the free preview",
            "pull the tools/list", "merged — thanks", "merged", "welcome, @rezearcher",
            "happy to take another", "this is a good fit", "appreciate you reaching out",
            "future version", "is on purpose"]

# Positive-but-conditional listing (directory accepted us; not a paying buyer).
LISTED = ["merged", "welcome, @rezearcher", "live and answering", "returns a live base usdc 402"]


def norm(b: str) -> str:
    # Normalise smart punctuation so "isn't"/"isn’t" match one vocabulary entry.
    return (b or "").lower().replace("’", "'").replace("‘", "'")


def first_hit(body: str, vocab):
    for term in vocab:
        if term in body:
            return term
    return None


def classify(user: str, body: str):
    """Return (bucket, reason_signal). Buckets ranked by decisiveness."""
    b = norm(body)
    if BOT_USER.search(user) or first_hit(b, BOT_BODY):
        return "bot_noise", first_hit(b, BOT_BODY) or "bot-user"
    # Closure wins over a polite positive preamble ("Thanks! ... Closing.")
    c = first_hit(b, CLOSED)
    wc = first_hit(b, WRONG_CHAIN)
    if c:
        return ("closed_wrong_chain" if wc else "closed"), c
    rc = first_hit(b, RECIPROCAL)
    if rc:
        return "reciprocal_seller", rc
    p = first_hit(b, POSITIVE)
    if p:
        # listed-only (directory) vs a real buyer-shaped yes
        if first_hit(b, LISTED) and "preview" not in b and "take you up" not in b:
            return "listed_directory", p
        return "convertible", p
    if wc:
        return "closed_wrong_chain", wc
    return "needs_review", None  # degrade open


def main():
    try:
        data = json.load(open(SENSOR_IN))
    except Exception as e:
        print(f"FATAL: cannot read reply sensor {SENSOR_IN}: {e}", file=sys.stderr)
        return 2
    replies = data.get("replies", [])

    # Dedup: keep the LAST reply per (repo-thread, user) — the most decisive word.
    latest = {}
    for r in replies:
        key = (r.get("url", ""), r.get("user", ""))
        prev = latest.get(key)
        if prev is None or r.get("at", "") >= prev.get("at", ""):
            latest[key] = r
    threads = list(latest.values())

    rows = []
    for r in threads:
        bucket, sig = classify(r.get("user", ""), r.get("body", ""))
        rows.append({
            "user": r.get("user", ""),
            "url": r.get("url", ""),
            "at": r.get("at", ""),
            "bucket": bucket,
            "signal": sig,
            "snippet": (r.get("body", "") or "").replace("\n", " ")[:120],
        })

    order = ["convertible", "needs_review", "listed_directory", "reciprocal_seller",
             "closed_wrong_chain", "closed", "bot_noise"]
    counts = {b: 0 for b in order}
    for row in rows:
        counts[row["bucket"]] = counts.get(row["bucket"], 0) + 1

    convertible = [r for r in rows if r["bucket"] == "convertible"]
    needs_review = [r for r in rows if r["bucket"] == "needs_review"]

    # --- stdout scoreboard ---
    print("=" * 68)
    print("x402 REPLY FUNNEL — honest conversion view (signal-derived, degrades open)")
    print("=" * 68)
    print(f"distinct threads classified : {len(rows)}  (raw replies: {len(replies)})")
    for b in order:
        print(f"  {b:>20} : {counts[b]}")
    human_demand = counts["convertible"] + counts["needs_review"]
    print(f"\nTRUE convertible+review pool : {human_demand}   "
          f"(vs gate 'replied' headline of {len(set(r.get('user','') for r in replies))})")
    print("\n--- CONVERTIBLE NOW (work these; everything else is proven-dead) ---")
    for r in sorted(convertible, key=lambda x: x["at"], reverse=True):
        print(f"  [{r['at'][:10]}] {r['user']:<20} {r['url'].split('github.com/')[-1]}")
        print(f"      signal='{r['signal']}' :: {r['snippet']}")
    if needs_review:
        print("\n--- NEEDS REVIEW (unmatched; eyeball before trusting as dead) ---")
        for r in needs_review:
            print(f"  {r['user']:<20} {r['url'].split('github.com/')[-1]} :: {r['snippet']}")

    # --- durable sensor artifact ---
    pathlib.Path(SENSOR_OUT_DIR).mkdir(parents=True, exist_ok=True)
    out = {
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": "ok",
        "summary": (f"{counts['convertible']} convertible, {counts['needs_review']} review, "
                    f"{counts['closed']+counts['closed_wrong_chain']} closed, "
                    f"{counts['reciprocal_seller']} reciprocal-seller, "
                    f"{counts['listed_directory']} listed, {counts['bot_noise']} bot"),
        "alert": counts["convertible"] > 0 or counts["needs_review"] > 0,
        "counts": counts,
        "true_convertible_pool": human_demand,
        "convertible": convertible,
        "needs_review": needs_review,
    }
    json.dump(out, open(os.path.join(SENSOR_OUT_DIR, "latest.json"), "w"), indent=1)
    print(f"\nwrote sensor -> {os.path.join(SENSOR_OUT_DIR, 'latest.json')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
