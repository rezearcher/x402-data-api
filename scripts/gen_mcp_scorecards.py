#!/usr/bin/env python3
"""
Generate and publish per-server MCP security scorecard pages to the Grey Ridge
Pages site (rezearcher/greyridge-x402-tools/docs — the Google-crawlable surface).

AgentSeal-style programmatic SEO: one crawlable, measured scorecard per well-known
public MCP server, each targeting the navigational "<server> mcp security / safe"
query (no incumbent answer today) and funneling the free teaser -> paid itemized
report -> $9.99/mo monitoring. Pages carry only measured, dated claims (Claims Law)
and read in the Grey Ridge human voice (PRODUCT BAR — no AI tells).

Usage:
  python3 scripts/gen_mcp_scorecards.py --dry-run     # scan + render locally, no push
  python3 scripts/gen_mcp_scorecards.py --publish     # scan + render + PUT to Pages repo

Data source for the scorecard = our own LIVE scanner (keyless preview):
  GET {BASE}/scan/mcp/preview?url=<server>&directory=true
"""
import argparse, base64, json, subprocess, sys, urllib.parse, urllib.request, datetime, os

BASE = os.environ.get("X402_BASE", "https://x402-data-api.sigrunner.workers.dev")
REPO = "rezearcher/greyridge-x402-tools"
DOCS = "docs"
UA = {"User-Agent": "Mozilla/5.0 (compatible; GreyRidgeScorecards/1.0)"}

# Curated list of real, well-known PUBLIC remote MCP servers that answer an
# unauthenticated tools/list (verified reachable 2026-10-22). Vendor one-liners are
# neutral descriptions of what each server is; no claim is made about the vendor.
SERVERS = [
    ("DeepWiki", "deepwiki", "https://mcp.deepwiki.com/mcp",
     "DeepWiki's MCP server exposes repository-documentation lookup tools to AI agents."),
    ("Wolfram Alpha", "wolfram-alpha", "https://agenttools.wolfram.com/mcp",
     "Wolfram's MCP server exposes computational-knowledge query tools to AI agents."),
    ("Hugging Face", "hugging-face", "https://hf.co/mcp",
     "Hugging Face's MCP server exposes model, dataset and Space search tools to AI agents."),
    ("Cloudflare Docs", "cloudflare-docs", "https://docs.mcp.cloudflare.com/mcp",
     "Cloudflare's documentation MCP server exposes docs-search tools to AI agents."),
    ("Astro Docs", "astro-docs", "https://mcp.docs.astro.build/mcp",
     "The Astro project's MCP server exposes documentation-search tools to AI agents."),
    ("Hive Intelligence", "hive-intelligence", "https://hiveintelligence.xyz/mcp",
     "Hive Intelligence's MCP server exposes crypto and market-data tools to AI agents."),
    ("Find A Domain", "find-a-domain", "https://api.findadomain.dev/mcp",
     "Find A Domain's MCP server exposes domain-availability lookup tools to AI agents."),
]


def scan(url):
    q = f"{BASE}/scan/mcp/preview?url={urllib.parse.quote(url, safe='')}&directory=true"
    req = urllib.request.Request(q, headers=UA)
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.load(r)


def verdict_line(d):
    v = d.get("verdict")
    n = d.get("tools_scanned", 0)
    ic = d.get("issue_count", 0)
    if v == "clear":
        return f"**No tool-poisoning or prompt-injection patterns** were found across the {n} tool definition(s) this server advertises."
    return f"**{ic} issue(s)** were flagged across {n} tool definition(s) — verdict `{v}`."


def readiness_line(d):
    dr = d.get("directory_readiness") or {}
    if dr.get("ready"):
        return ("**Claude Connector Directory readiness: ready.** Every advertised tool satisfies the "
                "structural rules Anthropic's published review criteria check for (names, annotations, "
                "permission hints, no catch-all read+write tool, no unsupported capability).")
    bc = dr.get("blocker_count", 0)
    return (f"**Claude Connector Directory readiness: {bc} blocker(s).** This server advertises {bc} "
            "tool definition(s) that would likely fail Anthropic's structural review criteria. The "
            "Connector Directory review runs about 20 days, so a rejection is expensive — the itemized "
            "list of which criteria fail, and how to fix each, is one paid call away.")


def render(name, slug, url, vendor, d, today):
    tools = d.get("tools_scanned", 0)
    v = d.get("verdict", "unknown")
    dr = d.get("directory_readiness") or {}
    ready = dr.get("ready")
    bc = dr.get("blocker_count", 0)
    ready_txt = "ready for the Claude Connector Directory" if ready else f"{bc} Claude Directory blocker(s)"
    desc = (f"Independent, measured security and Claude Connector Directory readiness scan of the "
            f"{name} MCP server ({url}), run {today}: {tools} tools scanned, injection verdict "
            f"'{v}', {ready_txt}. Re-run it yourself in one keyless call.")
    body = f"""---
title: Is the {name} MCP server safe? Security & Claude Directory readiness scan
description: {desc}
---
# {name} MCP server — security & directory-readiness scorecard

**Server:** `{url}`
**Scanned:** {today} · **Tools advertised:** {tools} · **Injection verdict:** `{v}` · **Directory:** {ready_txt}

{vendor} Before an agent — or a user — connects it, every tool definition it advertises is read
by the model, so a poisoned description or a hidden instruction can steer the agent before any
tool runs. This scorecard is an independent, static read of that advertised metadata, run against
the {name} server on the date above.

## What the scan found

- {verdict_line(d)}
- {readiness_line(d)}

The scan is **static analysis of the advertised `tools/list` metadata only** — it never invokes a
tool and never sends data anywhere. It is a point-in-time read: an MCP server's tool definitions can
change at any time (that is the "drift" risk this scorecard exists to make visible), so a clean result
today is not a guarantee for tomorrow.

## Re-run this scan yourself

No account, no key:

```bash
curl "{BASE}/scan/mcp/preview?url={url}&directory=true"
```

That free response gives you the verdict and the directory blocker **count**. For the **itemized
findings** — which tools, which OWASP LLM01/LLM08 pattern, and for the directory check *which* criteria
fail and how to fix each — the zero-egress paid report is one call:

```bash
curl -s -X POST {BASE}/scan/mcp -H 'content-type: application/json' \\
  -d '{{"directory":true,"url":"{url}"}}'
```

`$0.05 USDC` via [x402](https://x402.org) on Base, no account. To keep a server honest as it changes,
continuous drift monitoring with alerts is `$9.99/mo` — see [pricing]({BASE}/pricing).

## More

- [Scan any MCP server for prompt injection / tool poisoning](scan-mcp-server-prompt-injection.html)
- [Why was my Claude connector rejected? — directory readiness criteria](claude-connector-directory-readiness.html)
- [All scanned MCP servers](mcp-server-scorecards.html)

Independent scan by [Grey Ridge Signals](https://github.com/rezearcher/greyridge-x402-tools).
Measured on {today}; re-run the command above for a current result. Questions: contact@greyridgesignals.ai
"""
    return body, desc


def gh_get_sha(path):
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{path}"],
            stderr=subprocess.DEVNULL, env=ENV)
        return json.loads(out).get("sha")
    except subprocess.CalledProcessError:
        return None


def gh_put(path, content, msg):
    b64 = base64.b64encode(content.encode()).decode()
    sha = gh_get_sha(path)
    args = ["gh", "api", f"repos/{REPO}/contents/{path}", "-X", "PUT",
            "-f", f"message={msg}", "-f", f"content={b64}"]
    if sha:
        args += ["-f", f"sha={sha}"]
    subprocess.check_output(args, stderr=subprocess.STDOUT, env=ENV)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    today = datetime.date.today().isoformat()

    results = []
    for name, slug, url, vendor in SERVERS:
        try:
            d = scan(url)
        except Exception as e:
            print(f"SKIP {name}: {e}", file=sys.stderr)
            continue
        if d.get("tools_scanned", 0) < 1:
            print(f"SKIP {name}: no tools returned", file=sys.stderr)
            continue
        body, desc = render(name, slug, url, vendor, d, today)
        results.append((name, slug, url, d, body, desc))
        print(f"OK {name}: tools={d.get('tools_scanned')} verdict={d.get('verdict')} "
              f"blockers={(d.get('directory_readiness') or {}).get('blocker_count')}")

    # index page listing every scorecard
    rows = []
    for name, slug, url, d, body, desc in results:
        dr = d.get("directory_readiness") or {}
        rdy = "directory-ready" if dr.get("ready") else f"{dr.get('blocker_count',0)} directory blocker(s)"
        rows.append(f"- [{name}](mcp-{slug}-mcp-security.html) — `{d.get('verdict')}` injection verdict, "
                    f"{d.get('tools_scanned')} tools, {rdy}")
    index = f"""---
title: MCP server security scorecards — independent injection & directory-readiness scans
description: Independent, measured security and Claude Connector Directory readiness scans of well-known public MCP servers. Static tool-poisoning / prompt-injection analysis plus directory-readiness, each re-runnable keyless in one call.
---
# MCP server security scorecards

Independent, static security reads of well-known public MCP servers — each one scans the tool
definitions the server advertises for prompt-injection / tool-poisoning patterns (OWASP LLM01/LLM08)
and checks them against the Anthropic Claude Connector Directory review criteria. Every scorecard is
dated and re-runnable by you in one keyless call; results are point-in-time (tool definitions drift).

Last generated {today}.

{chr(10).join(rows)}

Scan a server not listed here:

```bash
curl "{BASE}/scan/mcp/preview?url=https://your-mcp-host/mcp&directory=true"
```

Method and the rest of the catalogue: [vet an MCP server before your agent trusts it](index.html).
Independent scans by [Grey Ridge Signals](https://github.com/rezearcher/greyridge-x402-tools).
"""

    if args.dry_run or not args.publish:
        os.makedirs("/tmp/scorecards", exist_ok=True)
        for name, slug, url, d, body, desc in results:
            p = f"/tmp/scorecards/mcp-{slug}-mcp-security.md"
            open(p, "w").write(body)
        open("/tmp/scorecards/mcp-server-scorecards.md", "w").write(index)
        print(f"\nDRY-RUN: {len(results)} scorecards written to /tmp/scorecards/")
        return

    # publish
    for name, slug, url, d, body, desc in results:
        path = f"{DOCS}/mcp-{slug}-mcp-security.md"
        gh_put(path, body, f"scorecards: {name} MCP server security + directory-readiness scan ({today})")
        print(f"PUT {path}")
    gh_put(f"{DOCS}/mcp-server-scorecards.md", index,
           f"scorecards: index of {len(results)} MCP server security scorecards ({today})")
    print(f"PUT {DOCS}/mcp-server-scorecards.md")
    # emit slugs for sitemap update
    open("/tmp/scorecard_slugs.txt", "w").write(
        "\n".join([f"mcp-{s}-mcp-security" for _, s, *_ in results] + ["mcp-server-scorecards"]))


if __name__ == "__main__":
    ENV = dict(os.environ)
    tok = subprocess.run(["bash", "scripts/gh_token.sh"], capture_output=True, text=True).stdout.strip()
    if tok:
        ENV["GH_TOKEN"] = tok
    main()
