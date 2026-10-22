#!/usr/bin/env python3
"""marketing_channel.py — the channel adapter the marketing-director agent calls to PUBLISH.

The agent has judgment (what asset, which channel, claim-review); THIS is the mechanical
publish step so nothing is ever posted by hand. Backends:
  - reddit : praw script-app (OAuth password grant)        [API]
  - hn     : Hacker News submit via headless browser         [no API → playwright]

Design rules (match the house style):
  - DRY-RUN BY DEFAULT. Nothing leaves the box without --publish.
  - Credentials come ONLY from the environment (sourced from ~/.config/greyridge/secrets.env
    via grsg-set-channel-creds); never args, never logged.
  - Append-only ledger at outreach/channel_post_ledger.jsonl (post attempts + results + urls).
  - Idempotency: a content hash (channel+target+title+body) is checked against the ledger;
    a duplicate is refused unless --force, so a re-run of the loop can't double-post.
  - Pacing guard: refuses a second post to the same (channel,target) within --min-gap-min.
  - Link tagging: appends ?ref=greyridge&utm_source=<channel> to bare greyridge/x402 URLs so
    the funnel can attribute conversions.
  - Exit 0 only on real success (or a clean dry-run); non-zero otherwise. No success theater.

CLI:
  marketing_channel.py post --channel reddit --target mcp \
      --title "..." --body-file path.md [--publish] [--flair "..."]
  marketing_channel.py post --channel hn --title "..." --url "https://..." \
      --comment-file first_comment.md [--publish]
  marketing_channel.py creds-check          # which backends are wired (no secrets printed)
  marketing_channel.py ledger [--n 20]      # recent post history
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, sys, time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LEDGER = REPO / "outreach" / "channel_post_ledger.jsonl"
UTM_HOSTS = ("greyridgesignals.ai", "x402-data-api.sigrunner.workers.dev")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tag_links(text: str, channel: str) -> str:
    """Append attribution params to our own bare URLs so conversions are traceable."""
    def repl(m):
        url = m.group(0)
        if not any(h in url for h in UTM_HOSTS):
            return url
        if "ref=" in url or "utm_" in url:
            return url
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}ref=greyridge&utm_source={channel}"
    return re.sub(r"https?://[^\s)\]]+", repl, text)


def _content_hash(channel: str, target: str, title: str, body: str) -> str:
    h = hashlib.sha256()
    h.update(f"{channel}\x00{target}\x00{title}\x00{body}".encode())
    return h.hexdigest()[:16]


def _ledger_rows() -> list[dict]:
    if not LEDGER.exists():
        return []
    out = []
    for line in LEDGER.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def _ledger_append(row: dict) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a") as f:
        f.write(json.dumps(row) + "\n")


def _guard(channel: str, target: str, chash: str, min_gap_min: int, force: bool) -> str | None:
    """Return a refusal reason, or None if clear to post."""
    rows = _ledger_rows()
    for r in rows:
        if r.get("content_hash") == chash and r.get("result") == "ok" and not force:
            return f"duplicate: this exact post already succeeded ({r.get('url') or r.get('ts')}) — use --force to override"
    if min_gap_min > 0:
        cutoff = time.time() - min_gap_min * 60
        for r in rows:
            if r.get("channel") == channel and r.get("target") == target and r.get("result") == "ok":
                try:
                    t = datetime.fromisoformat(r["ts"]).timestamp()
                except Exception:
                    continue
                if t > cutoff and not force:
                    return f"pacing: posted to {channel}/{target} <{min_gap_min}m ago — use --force to override"
    return None


# ── Reddit backend (praw) ──────────────────────────────────────────────────
def _reddit_client():
    import praw  # noqa
    cid = os.environ.get("REDDIT_CLIENT_ID")
    csec = os.environ.get("REDDIT_CLIENT_SECRET")
    user = os.environ.get("REDDIT_USERNAME")
    pw = os.environ.get("REDDIT_PASSWORD")
    missing = [k for k, v in {
        "REDDIT_CLIENT_ID": cid, "REDDIT_CLIENT_SECRET": csec,
        "REDDIT_USERNAME": user, "REDDIT_PASSWORD": pw}.items() if not v]
    if missing:
        raise RuntimeError("reddit creds missing: " + ", ".join(missing) + " (run grsg-set-channel-creds)")
    ua = os.environ.get("REDDIT_USER_AGENT", f"greyridge-marketing-director/1.0 by u/{user}")
    r = praw.Reddit(client_id=cid, client_secret=csec, username=user, password=pw, user_agent=ua)
    _ = r.user.me()  # forces auth; raises on bad creds
    return r


def post_reddit(target: str, title: str, body: str, flair: str | None, publish: bool) -> dict:
    body = _tag_links(body, "reddit")
    if not publish:
        return {"result": "dryrun", "channel": "reddit", "target": target,
                "title": title, "preview": body[:400]}
    r = _reddit_client()
    sub = r.subreddit(target)
    kwargs = {"title": title, "selftext": body}
    if flair:
        try:
            for t in sub.flair.link_templates:
                if flair.lower() in (t.get("flair_text") or "").lower():
                    kwargs["flair_id"] = t["flair_template_id"]
                    break
        except Exception:
            pass
    sub_post = sub.submit(**kwargs)
    return {"result": "ok", "channel": "reddit", "target": target,
            "url": f"https://reddit.com{sub_post.permalink}", "id": sub_post.id}


# ── Hacker News backend (headless browser; HN has no write API) ─────────────
def post_hn(title: str, url: str | None, comment: str | None, publish: bool) -> dict:
    user = os.environ.get("HN_USERNAME")
    pw = os.environ.get("HN_PASSWORD")
    if url:
        url = _tag_links(url, "hn")
    if not publish:
        return {"result": "dryrun", "channel": "hn", "target": "news",
                "title": title, "url": url, "comment_preview": (comment or "")[:400]}
    if not (user and pw):
        raise RuntimeError("hn creds missing: HN_USERNAME, HN_PASSWORD (run grsg-set-channel-creds)")
    from playwright.sync_api import sync_playwright
    out = {"result": "ok", "channel": "hn", "target": "news", "title": title}
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page()
        pg.goto("https://news.ycombinator.com/login", wait_until="domcontentloaded")
        # first login form on the page is the existing-user login
        pg.fill("form:nth-of-type(1) input[name=acct]", user)
        pg.fill("form:nth-of-type(1) input[name=pw]", pw)
        pg.click("form:nth-of-type(1) input[type=submit]")
        pg.wait_for_load_state("domcontentloaded")
        pg.goto("https://news.ycombinator.com/submit", wait_until="domcontentloaded")
        if pg.query_selector("input[name=title]") is None:
            b.close()
            raise RuntimeError("HN submit page not reachable — login likely failed")
        pg.fill("input[name=title]", title)
        if url:
            pg.fill("input[name=url]", url)
        pg.click("input[type=submit]")
        pg.wait_for_load_state("domcontentloaded")
        out["url"] = pg.url
        b.close()
    return out


def cmd_post(a) -> int:
    body = ""
    if a.body_file:
        body = Path(a.body_file).read_text()
    elif a.comment_file:
        body = Path(a.comment_file).read_text()
    target = a.target or ("news" if a.channel == "hn" else "")
    chash = _content_hash(a.channel, target, a.title, body)
    reason = _guard(a.channel, target, chash, a.min_gap_min, a.force)
    if reason:
        print(f"REFUSED — {reason}")
        return 2
    base = {"ts": now_iso(), "channel": a.channel, "target": target,
            "title": a.title, "content_hash": chash, "published": bool(a.publish)}
    try:
        if a.channel == "reddit":
            res = post_reddit(target, a.title, body, a.flair, a.publish)
        elif a.channel == "hn":
            res = post_hn(a.title, a.url, body or None, a.publish)
        else:
            print(f"unknown channel: {a.channel}")
            return 2
    except Exception as e:
        row = {**base, "result": "error", "error": f"{type(e).__name__}: {e}"}
        _ledger_append(row)
        print(f"ERROR — {row['error']}")
        return 1
    row = {**base, **res}
    _ledger_append(row)
    if res["result"] == "dryrun":
        print(f"DRY-RUN ok ({a.channel}/{target}) — would post:\n  title: {a.title}")
        print(f"  {('url: ' + (a.url or '')) if a.channel=='hn' else 'body chars: ' + str(len(body))}")
        print("  re-run with --publish to post for real.")
        return 0
    print(f"PUBLISHED ({a.channel}) → {res.get('url')}")
    return 0


def cmd_creds_check(_a) -> int:
    reddit_ok = all(os.environ.get(k) for k in
                    ("REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"))
    hn_ok = all(os.environ.get(k) for k in ("HN_USERNAME", "HN_PASSWORD"))
    print(f"reddit backend: {'WIRED' if reddit_ok else 'missing creds (grsg-set-channel-creds)'}")
    print(f"hn backend:     {'WIRED' if hn_ok else 'missing creds (grsg-set-channel-creds)'}")
    try:
        import praw  # noqa
        print(f"praw: {praw.__version__}")
    except Exception:
        print("praw: NOT installed")
    try:
        import playwright  # noqa
        print("playwright: installed")
    except Exception:
        print("playwright: NOT installed")
    return 0


def cmd_ledger(a) -> int:
    rows = _ledger_rows()[-a.n:]
    for r in rows:
        print(f"{r.get('ts','?')}  {r.get('channel','?')}/{r.get('target','?')}  "
              f"{r.get('result','?')}  {r.get('url') or r.get('error') or ''}")
    if not rows:
        print("(no posts yet)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="marketing-director channel adapter")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("post")
    p.add_argument("--channel", required=True, choices=["reddit", "hn"])
    p.add_argument("--target", help="subreddit (reddit) e.g. mcp; ignored for hn")
    p.add_argument("--title", required=True)
    p.add_argument("--body-file", help="selftext (reddit) markdown file")
    p.add_argument("--url", help="submission url (hn)")
    p.add_argument("--comment-file", help="first-comment / body file (hn)")
    p.add_argument("--flair")
    p.add_argument("--min-gap-min", type=int, default=180, help="min minutes between posts to same channel/target")
    p.add_argument("--force", action="store_true")
    p.add_argument("--publish", action="store_true", help="actually post (default: dry-run)")
    p.set_defaults(fn=cmd_post)
    c = sub.add_parser("creds-check")
    c.set_defaults(fn=cmd_creds_check)
    lg = sub.add_parser("ledger")
    lg.add_argument("--n", type=int, default=20)
    lg.set_defaults(fn=cmd_ledger)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
