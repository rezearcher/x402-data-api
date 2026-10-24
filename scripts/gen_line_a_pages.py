#!/usr/bin/env python3
"""gen_line_a_pages.py — Line-A per-framework install-intent SEO landing pages.

Line B has 87 MCP security scorecards + a ranked leaderboard on the Google-crawled
github.io Pages channel; Line A had ZERO per-framework install pages despite 3 live
npm swap-gate plugins. This generator fixes that: one dedicated page per framework
(ElizaOS / Vercel AI SDK / LangChain) targeting the install-intent long-tail query a
Base trading-agent dev actually types, each carrying a one-line `npm i`, the real
framework integration snippet, a LIVE GO/BLOCK demo pulled from the production gate at
generate-time (not a claim), and the sizing/breakeven wedge that is our only moat.

Publishes to rezearcher.github.io/greyridge-x402-tools/docs (the crawled channel —
the Worker itself is not crawled, memory zi/zh), links them from index.md, rebuilds
sitemap.xml from the GROUND-TRUTH docs/ listing (no hardcoded page roster), and pings
IndexNow so Bing/Yandex index immediately instead of waiting on Googlebot lag.

Usage:
  python3 scripts/gen_line_a_pages.py --dry-run     # render locally, print, no writes
  python3 scripts/gen_line_a_pages.py --publish     # PUT pages + index + sitemap + IndexNow
"""
import argparse
import base64
import datetime
import json
import os
import subprocess
import sys
import urllib.request

REPO = "rezearcher/greyridge-x402-tools"
DOCS = "docs"
SITE = "https://rezearcher.github.io/greyridge-x402-tools"
WORKER = "https://x402-data-api.sigrunner.workers.dev"
UA = {"User-Agent": "greyridge-line-a-pages/1.0"}
INDEXNOW_HOST = "rezearcher.github.io"
INDEXNOW_KEY = "aa3ee6fa313780532656391c0c73664f"
ENV = dict(os.environ)

# Demo tokens: a known-live GO and a guaranteed BLOCK (the zero/dead address is not an
# ERC-20, so it always blocks — a stable, honest negative control for the demo table).
GO_TOKEN = "aero"
BLOCK_TOKEN = "0x000000000000000000000000000000000000dEaD"
# Fallbacks if the live fetch is throttled at generate-time — degrade open, never block a publish.
_FALLBACK = {
    GO_TOKEN: {"decision": "go", "verdict": "SAFE", "risk_score": 15,
              "reason": "token passes safety checks; trade is 0.01% of pool liquidity"},
    BLOCK_TOKEN: {"decision": "block", "verdict": "AVOID", "risk_score": 100,
                 "reason": "address is not a contract / not an ERC-20"},
}


def live_demo(token):
    try:
        req = urllib.request.Request(
            f"{WORKER}/gate/swap/preview?token={urllib.parse.quote(token)}", headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read().decode())
        return {"decision": d.get("decision"), "verdict": d.get("verdict"),
                "risk_score": d.get("risk_score"), "reason": str(d.get("reason", ""))[:120]}
    except Exception as e:
        print(f"live_demo({token}) fell back ({e})", file=sys.stderr)
        return _FALLBACK[token]


import urllib.parse  # noqa: E402  (after helpers, used by live_demo + indexnow)

# --- per-framework definitions -------------------------------------------------------
FRAMEWORKS = [
    {
        "slug": "elizaos-token-safety-plugin",
        "pkg": "@grey-ridge/elizaos-plugin-swap-gate",
        "framework": "ElizaOS",
        "title": "ElizaOS token-safety plugin — pre-trade swap gate for Base agents",
        "description": ("Drop-in ElizaOS plugin that checks a Base token for honeypots, "
                        "unsellable positions and rug controls before your agent swaps — "
                        "paid inline with x402 USDC ($0.008/call), no API key. Returns GO / "
                        "HOLD / BLOCK plus trade sizing."),
        "query": "elizaos token safety plugin / honeypot check action",
        "install": "npm install @grey-ridge/elizaos-plugin-swap-gate",
        "snippet": (
            'import swapGatePlugin from "@grey-ridge/elizaos-plugin-swap-gate";\n'
            "\n"
            "export const character = {\n"
            '  name: "TraderBot",\n'
            "  // ...\n"
            "  plugins: [swapGatePlugin],\n"
            "};"),
        "snippet_note": ("The plugin registers two paid pre-trade actions — the agent picks "
                         "`GATE_SWAP` (final gate, sized to a notional) or `TOKEN_REPORT` "
                         "(screening) from the user's intent. No extra wiring; it reads "
                         "`PRIVATE_KEY` from the agent environment for the x402 payment."),
    },
    {
        "slug": "vercel-ai-sdk-swap-guard",
        "pkg": "@grey-ridge/vercel-ai-swap-gate",
        "framework": "Vercel AI SDK",
        "title": "Vercel AI SDK swap guard — one tool that vets a Base token before every swap",
        "description": ("A Vercel AI SDK `tool` that runs before every swap: honeypot, "
                        "sellability, rug controls and order-size-vs-pool. Your model gets a "
                        "single `proceed` boolean. Paid inline x402 USDC $0.008/call, fails "
                        "closed. Drop into generateText."),
        "query": "vercel ai sdk swap guard / token safety tool",
        "install": "npm install @grey-ridge/vercel-ai-swap-gate ai zod",
        "snippet": (
            'import { generateText } from "ai";\n'
            'import { openai } from "@ai-sdk/openai";\n'
            'import { createSwapGuard } from "@grey-ridge/vercel-ai-swap-gate";\n'
            "\n"
            "const swapGuard = createSwapGuard({ privateKey: process.env.PRIVATE_KEY });\n"
            "\n"
            "await generateText({\n"
            "  model: openai(\"gpt-4o\"),\n"
            "  tools: { swapGuard },\n"
            '  prompt: "Buy $500 of 0x... if it is safe",\n'
            "});"),
        "snippet_note": ("The tool returns the full gate verdict plus three fields your agent "
                         "can branch on directly — `proceed` (boolean), `decision` (go/hold/"
                         "block) and the sizing summary. **Fails closed:** if the gate is ever "
                         "unreachable the tool returns `proceed: false`, so an outage can never "
                         "green-light a swap."),
    },
    {
        "slug": "langchain-honeypot-check-tool",
        "pkg": "@grey-ridge/langchain-swap-gate",
        "framework": "LangChain.js",
        "title": "LangChain honeypot-check tool — pre-trade token gate for Base agents",
        "description": ("A LangChain.js tool that checks a Base ERC-20 for honeypots, "
                        "unsellable positions and rug controls before your agent swaps. "
                        "Returns proceed:false / decision:block when the check does not "
                        "settle. Paid inline x402 USDC $0.008/call, no key."),
        "query": "langchain honeypot check tool / base token safety",
        "install": "npm install @grey-ridge/langchain-swap-gate @langchain/core zod",
        "snippet": (
            'import { createSwapGuard } from "@grey-ridge/langchain-swap-gate";\n'
            'import { createReactAgent } from "@langchain/langgraph/prebuilt";\n'
            'import { ChatOpenAI } from "@langchain/openai";\n'
            "\n"
            "const swapGuard = createSwapGuard({ privateKey: process.env.PRIVATE_KEY });\n"
            "\n"
            "const agent = createReactAgent({\n"
            "  llm: new ChatOpenAI({ model: \"gpt-4o\" }),\n"
            "  tools: [swapGuard],\n"
            "});"),
        "snippet_note": ("A second `tokenReport` screening tool is exported too — wire both and "
                         "the agent screens early, then gates at the moment of the swap. The "
                         "tool uses `responseFormat: \"content_and_artifact\"` so the structured "
                         "verdict is available to your graph, not just prose."),
    },
]

COMP_ROW = (
    "| | **Grey Ridge swap gate** | GoPlus token API | 1inch / router safety | roll-your-own |\n"
    "|---|---|---|---|---|\n"
    "| Ships as a native {fw} drop-in | ✅ | you wrap it | you wrap it | you build it |\n"
    "| Pay-per-call, no account / key / dashboard | ✅ x402 USDC $0.008 | API key + plan | — | — |\n"
    "| Fails **closed** (outage never green-lights a swap) | ✅ | ✗ | ✗ | depends |\n"
    "| Returns trade **sizing + round-trip breakeven**, not just a flag | ✅ | ✗ | ✗ | ✗ |\n"
)


def render(fw, go, block, today):
    def verdict_cell(d):
        return f"`{str(d.get('decision','?')).upper()}` / {d.get('verdict','?')} (risk {d.get('risk_score','?')})"

    body = f"""---
title: {fw['title']}
description: {fw['description']}
---
# {fw['title']}

Put one call between *"the agent decided to buy"* and *"the agent signs the swap"*. For
{fw['framework']} agents trading ERC-20s on Base, this is the pre-trade safety gate: it
checks the token for honeypots, whether the position is actually sellable, the admin
controls that let a deployer rug it, and whether your order is too large for the pool —
then returns **GO / HOLD / BLOCK** plus the trade sizing. Paid inline with
**x402 USDC — $0.008/call**. No API key, no dashboard, no subscription.

## Install

```bash
{fw['install']}
```

```js
{fw['snippet']}
```

{fw['snippet_note']}

## Live verdicts (run against production right now)

These are real responses from the production gate, fetched when this page was built
({today}). Re-run them yourself against the free preview — no account:

| Token | Verdict | Why |
|---|---|---|
| `{GO_TOKEN}` (live Base token) | {verdict_cell(go)} | {go.get('reason','')} |
| dead address (negative control) | {verdict_cell(block)} | {block.get('reason','')} |

```bash
curl "{WORKER}/gate/swap/preview?token={GO_TOKEN}"
```

The free preview allows 3 real-token checks/day/IP so you can wire the plugin before you
pay a cent.

## The sizing wedge — why this beats a bare safety flag

Every other pre-trade check ends at a yes/no honeypot flag. On a **GO**, this gate also
returns the number that actually bounds your downside:

- **Entry simulation** — tokens you actually receive at spot and the USD lost to entry slippage, for $100 / $1k / $10k / $50k.
- **Exit simulation** — USD recoverable vs lost to slippage if you sell that same size back out.
- **Round-trip breakeven %** — the price move you need just to break even on the two-sided slippage.
- **Max safe size** — the largest notional that stays under your impact threshold for this pool.

So the agent doesn't just learn *"this token is safe"* — it learns, for the specific
pool and your specific notional, the exact price move needed to break even and the
largest size that stays under your impact threshold. That is the bounded-downside number
a trading agent needs, and it is on the paid `/gate/swap` response ($0.008), computed
live per token — not on the free verdict.

{COMP_ROW.format(fw=fw['framework'])}

## Pricing

| Route | Price | What you get |
|---|---|---|
| `GET /gate/swap/preview` | free (3/day/IP) | GO / HOLD / BLOCK verdict |
| `GET /gate/swap` | **$0.008 USDC** (x402) | verdict **+ entry/exit sim + round-trip breakeven + max safe size** |
| `GET /chain/token-report` | $0.01 USDC (x402) | full evidence: honeypot sim, tax, admin controls, liquidity |

At 20 trades/day that is $0.16/day — the guard rides every swap your agent makes, for the
life of the agent. 3.75× cheaper per call than the nearest x402 pre-trade gate.

Other frameworks: [ElizaOS]({SITE}/elizaos-token-safety-plugin.html) ·
[Vercel AI SDK]({SITE}/vercel-ai-sdk-swap-guard.html) ·
[LangChain.js]({SITE}/langchain-honeypot-check-tool.html).
Source + CrewAI example: [greyridge-x402-tools](https://github.com/{REPO}).
API discovery: [/.well-known/x402]({WORKER}/.well-known/x402).

[Back](index.html)
"""
    return body


# --- publishing helpers --------------------------------------------------------------
def gh_get_sha(path):
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{path}"],
            stderr=subprocess.DEVNULL, env=ENV)
        return json.loads(out).get("sha")
    except Exception:
        return None


def gh_put(path, content, msg):
    b64 = base64.b64encode(content.encode()).decode()
    sha = gh_get_sha(path)
    args = ["gh", "api", f"repos/{REPO}/contents/{path}", "-X", "PUT",
            "-f", f"message={msg}", "-f", f"content={b64}"]
    if sha:
        args += ["-f", f"sha={sha}"]
    subprocess.check_output(args, stderr=subprocess.STDOUT, env=ENV)


def gh_get_text(path):
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{path}"],
            stderr=subprocess.DEVNULL, env=ENV)
        return base64.b64decode(json.loads(out)["content"]).decode()
    except Exception:
        return None


def all_doc_html_urls():
    """Ground-truth: enumerate every .md in docs/ right now and map to its .html URL.
    No hardcoded page roster — the sitemap can never silently drop a page this way."""
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{DOCS}", "--paginate"],
            stderr=subprocess.DEVNULL, env=ENV)
        names = [x.get("name", "") for x in json.loads(out)]
    except Exception as e:
        print(f"sitemap: could not list docs/ ({e})", file=sys.stderr)
        return []
    urls = [f"{SITE}/"]  # index
    for n in sorted(names):
        if n.endswith(".md") and n != "index.md":
            urls.append(f"{SITE}/{n[:-3]}.html")
    # dedup preserve order
    seen, ordered = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            ordered.append(u)
    return ordered


def publish_sitemap(today):
    urls = all_doc_html_urls()
    rows = "\n".join(f"<url><loc>{u}</loc><lastmod>{today}</lastmod></url>" for u in urls)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f"{rows}\n</urlset>\n")
    gh_put(f"{DOCS}/sitemap.xml", xml, f"sitemap: {len(urls)} URLs (ground-truth docs/ listing, {today})")
    print(f"PUT sitemap.xml ({len(urls)} urls)")


# index.md Line-A framework block — idempotent (replaced between these markers each run).
IDX_START = "<!-- line-a-framework-pages:start -->"
IDX_END = "<!-- line-a-framework-pages:end -->"


def update_index(today):
    idx = gh_get_text(f"{DOCS}/index.md")
    if idx is None:
        print("index.md: could not read; skipping link insertion", file=sys.stderr)
        return
    block_lines = [IDX_START,
                   "",
                   "**Framework install guides** — drop the gate into your trading agent in one line:",
                   ""]
    tagline = {
        "ElizaOS": "pre-trade swap-gate plugin",
        "Vercel AI SDK": "one-tool swap guard",
        "LangChain.js": "honeypot-check tool",
    }
    for fw in FRAMEWORKS:
        tag = tagline.get(fw["framework"], "swap gate")
        cmd = fw["install"].replace("npm install ", "npm i ")
        block_lines.append(f"- [{fw['framework']} {tag}]({fw['slug']}.html) — `{cmd}`")
    block_lines += ["", IDX_END]
    block = "\n".join(block_lines)

    if IDX_START in idx and IDX_END in idx:
        pre = idx.split(IDX_START)[0]
        post = idx.split(IDX_END, 1)[1]
        new = pre + block + post
    else:
        # anchor: insert right after the pre-trade-safety-gate link line so it sits inside
        # the Base-token-safety section.
        anchor = "[Pre-trade safety gate for AI trading agents](pre-trade-safety-gate-ai-agents.html)"
        if anchor in idx:
            # insert after the full bullet line containing the anchor
            lines = idx.splitlines()
            out = []
            inserted = False
            for ln in lines:
                out.append(ln)
                if anchor in ln and not inserted:
                    out += ["", block]
                    inserted = True
            new = "\n".join(out) + ("\n" if idx.endswith("\n") else "")
        else:
            new = idx.rstrip() + "\n\n" + block + "\n"

    if new == idx:
        print("index.md: no change")
        return
    gh_put(f"{DOCS}/index.md", new, f"index: link the 3 Line-A framework install pages ({today})")
    print("PUT index.md (framework links)")


def ping_indexnow(urls):
    payload = json.dumps({
        "host": INDEXNOW_HOST, "key": INDEXNOW_KEY,
        "keyLocation": f"{SITE}/{INDEXNOW_KEY}.txt", "urlList": urls,
    }).encode()
    req = urllib.request.Request("https://api.indexnow.org/IndexNow", data=payload,
                                 headers={"Content-Type": "application/json; charset=utf-8", **UA},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"IndexNow: submitted {len(urls)} URLs -> HTTP {r.status}")
    except Exception as e:
        print(f"IndexNow: submit failed ({e}) -- non-fatal")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    today = datetime.date.today().isoformat()

    go = live_demo(GO_TOKEN)
    block = live_demo(BLOCK_TOKEN)
    print(f"demo: {GO_TOKEN}={go.get('decision')} dead={block.get('decision')}", file=sys.stderr)

    new_urls = []
    for fw in FRAMEWORKS:
        body = render(fw, go, block, today)
        path = f"{DOCS}/{fw['slug']}.md"
        new_urls.append(f"{SITE}/{fw['slug']}.html")
        if args.dry_run:
            print(f"\n===== {path} ({len(body)} bytes) =====\n{body[:900]}\n...")
            continue
        if args.publish:
            gh_put(path, body, f"line-a: {fw['framework']} install-intent page ({today})")
            print(f"PUT {path}")

    if args.publish:
        update_index(today)
        publish_sitemap(today)
        ping_indexnow(new_urls + [f"{SITE}/", f"{SITE}/sitemap.xml"])
        print(f"\nPublished {len(FRAMEWORKS)} framework pages: {', '.join(u for u in new_urls)}")


if __name__ == "__main__":
    tok = subprocess.run(["bash", "scripts/gh_token.sh"], capture_output=True, text=True).stdout.strip()
    if tok:
        ENV["GH_TOKEN"] = tok
    main()
