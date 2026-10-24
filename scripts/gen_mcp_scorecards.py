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
  python3 scripts/gen_mcp_scorecards.py --dry-run             # scan curated set locally, no push
  python3 scripts/gen_mcp_scorecards.py --publish             # scan curated set + PUT to Pages
  python3 scripts/gen_mcp_scorecards.py --from-registry --publish --scan-cap 30
        # ALSO discover live public servers from the official MCP registry at runtime,
        # scan the ones that answer an unauthenticated tools/list, publish a scorecard each

Data source for the scorecard = our own LIVE scanner (keyless preview):
  GET {BASE}/scan/mcp/preview?url=<server>&directory=true

Server discovery (the --from-registry path) is the ground-truth signal, not a hand list:
the official registry (registry.modelcontextprotocol.io) is the canonical roster of public
MCP servers. We pull the active, latest entries that advertise a remote HTTP endpoint and keep
only those that actually answer an unauthenticated tools/list. This is how the AgentSeal SEO
moat scales — one crawlable, measured long-tail page per real public server — without a
brittle hardcoded roster that silently rots as servers come and go.
"""
import argparse, base64, json, subprocess, sys, urllib.parse, urllib.request, datetime, os

BASE = os.environ.get("X402_BASE", "https://x402-data-api.sigrunner.workers.dev")
REPO = "rezearcher/greyridge-x402-tools"
DOCS = "docs"
REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers"
UA = {"User-Agent": "Mozilla/5.0 (compatible; GreyRidgeScorecards/1.0)"}

# Curated anchor set of real, well-known PUBLIC remote MCP servers (verified reachable
# 2026-10-22). These are kept hand-named for display polish; everything beyond them is
# DISCOVERED from the registry at runtime via --from-registry (no hardcoded roster as the
# gate for coverage). Vendor one-liners are neutral descriptions; no claim about the vendor.
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


def _slugify(host):
    s = host.lower().strip()
    for pre in ("www.", "mcp.", "api.", "app.", "server."):
        if s.startswith(pre):
            s = s[len(pre):]
    s = "".join(c if (c.isalnum() or c == ".") else "-" for c in s)
    s = s.replace(".", "-").strip("-")
    while "--" in s:
        s = s.replace("--", "-")
    return s or "server"


def _display_name(title, host):
    t = (title or "").strip()
    if t and len(t) <= 40 and "/" not in t:
        return t
    # fall back to the bare host, which is what a user would actually search for
    return host


def _fetch_registry(pages, per_page=100):
    """Yield (title, description, url) for active, latest registry entries that
    advertise a remote HTTP endpoint. The registry is the ground-truth roster."""
    cursor = None
    for _ in range(pages):
        q = f"{REGISTRY}?limit={per_page}" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        req = urllib.request.Request(q, headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
        except Exception as e:
            print(f"registry fetch stopped: {e}", file=sys.stderr)
            return
        for entry in d.get("servers", []):
            srv = entry.get("server", entry)
            meta = (entry.get("_meta") or {}).get("io.modelcontextprotocol.registry/official", {})
            if meta.get("status") != "active" or not meta.get("isLatest", True):
                continue
            for rem in (srv.get("remotes") or []):
                url = rem.get("url", "")
                if rem.get("type") in ("streamable-http", "http", "sse") and url.startswith("http"):
                    yield srv.get("title"), srv.get("description"), url
                    break
        cursor = (d.get("metadata") or {}).get("nextCursor")
        if not cursor:
            return


def discover_servers(scan_cap, pages, seen_urls, seen_slugs):
    """Discover live public MCP servers from the registry and keep only those that
    answer an unauthenticated tools/list with at least one tool. Returns scored tuples
    (name, slug, url, vendor) ready to render. Bounded by scan_cap."""
    out = []
    checked = 0
    for title, desc, url in _fetch_registry(pages):
        parsed = urllib.parse.urlparse(url)
        key = (parsed.netloc + parsed.path.rstrip("/")).lower()
        if key in seen_urls:
            continue
        seen_urls.add(key)
        host = parsed.netloc
        slug = _slugify(host)
        if slug in seen_slugs:
            continue
        name = _display_name(title, host)
        vendor = (desc or "").strip().replace("\n", " ")
        if len(vendor) > 220:
            vendor = vendor[:217].rstrip() + "..."
        if not vendor:
            vendor = f"The {name} MCP server exposes tools to AI agents over a public remote endpoint."
        checked += 1
        try:
            d = scan(url)
        except Exception as e:
            print(f"  discover SKIP {host}: {e}", file=sys.stderr)
            continue
        if d.get("tools_scanned", 0) < 1:
            continue
        seen_slugs.add(slug)
        out.append((name, slug, url, vendor, d))
        print(f"  discover OK {name} ({host}): tools={d.get('tools_scanned')} "
              f"verdict={d.get('verdict')} blockers={(d.get('directory_readiness') or {}).get('blocker_count')}")
        if len(out) >= scan_cap:
            break
    print(f"discovery: probed {checked} registry endpoint(s), kept {len(out)} live scorecard(s)",
          file=sys.stderr)
    return out


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


_MCP_HDRS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "User-Agent": UA["User-Agent"],
}


def _mcp_post(url, payload, session_id=None, timeout=20):
    """POST one JSON-RPC message to an MCP Streamable-HTTP endpoint. Returns
    (parsed_result_dict_or_None, session_id). Parses both plain-JSON and SSE
    (`event: message\\ndata: {...}`) response bodies. Degrade-open: any failure
    returns (None, session_id)."""
    hdrs = dict(_MCP_HDRS)
    if session_id:
        hdrs["Mcp-Session-Id"] = session_id
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            sid = r.headers.get("Mcp-Session-Id") or session_id
            raw = r.read().decode("utf-8", "replace")
    except Exception:
        return None, session_id
    # Collect every JSON object carried on a `data:` line (SSE) or the whole body (plain JSON).
    objs = []
    saw_sse = False
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            saw_sse = True
            frag = line[5:].strip()
            if frag and frag != "[DONE]":
                try:
                    objs.append(json.loads(frag))
                except Exception:
                    pass
    if not saw_sse:
        try:
            objs.append(json.loads(raw))
        except Exception:
            pass
    for o in objs:
        if isinstance(o, dict) and "result" in o:
            return o["result"], sid
    return None, sid


def fetch_tools(url):
    """Fetch a server's advertised tool list + self-description via the SAME public
    unauthenticated read the scan performs (initialize -> tools/list). Read-only, no
    auth bypass. Returns (tools:list, instructions:str). Degrade-open: ([], '')."""
    init, sid = _mcp_post(url, {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "greyridge-scorecards", "version": "1.0"}},
    })
    instructions = ""
    if isinstance(init, dict):
        instructions = (init.get("instructions") or "").strip()
    # Best-effort initialized notification (some servers require it before tools/list).
    try:
        _mcp_post(url, {"jsonrpc": "2.0", "method": "notifications/initialized"}, session_id=sid, timeout=10)
    except Exception:
        pass
    res, _ = _mcp_post(url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id=sid)
    tools = []
    if isinstance(res, dict) and isinstance(res.get("tools"), list):
        tools = res["tools"]
    return tools, instructions


def _clean(s, n=160):
    """Sanitise third-party text for safe inline-Markdown embedding on our page:
    collapse whitespace, strip angle brackets/backticks (no HTML/code-fence injection),
    truncate to n chars. Returns '' for empty."""
    if not s:
        return ""
    s = str(s).replace("`", "'").replace("<", "").replace(">", "")
    s = " ".join(s.split())
    if len(s) > n:
        s = s[: n - 1].rstrip() + "…"
    return s


def tools_section(name, tools, instructions):
    """Unique, per-server Markdown: the real advertised tool names + one-line
    descriptions (Glama-parity depth) plus a self-description line where present.
    This is public tools/list metadata, non-cannibalising (injection FINDINGS and
    directory REMEDIATION stay paid-gated). Returns '' when no tools were fetched
    (generator then falls back to the count-only template, still publishes)."""
    if not tools:
        return ""
    lines = [f"## Tools the {name} server advertises", ""]
    desc0 = _clean(instructions, 260)
    if desc0:
        lines.append(f"The server describes itself to connecting agents as: *{desc0}*")
        lines.append("")
    lines.append(
        f"These are the {len(tools)} tool definition(s) any agent reads before it acts — the exact "
        "surface this scan inspects for tool-poisoning and hidden-instruction patterns. Names and "
        "descriptions are read verbatim from the server's public `tools/list`:")
    lines.append("")
    for t in tools:
        if not isinstance(t, dict):
            continue
        tname = _clean(t.get("name"), 80) or "(unnamed)"
        tdesc = _clean(t.get("description"), 180)
        params = []
        schema = t.get("inputSchema") or t.get("input_schema") or {}
        props = schema.get("properties") if isinstance(schema, dict) else None
        if isinstance(props, dict):
            params = [p for p in list(props.keys())[:6] if isinstance(p, str)]
        row = f"- **`{tname}`**"
        if tdesc:
            row += f" — {tdesc}"
        if params:
            row += f" _(parameters: {', '.join(_clean(p, 40) for p in params)})_"
        lines.append(row)
    lines.append("")
    return "\n".join(lines)


_WRITE_VERBS = ("create", "update", "delete", "remove", "write", "send", "set", "manage",
                "edit", "post", "put", "patch", "add", "execute", "run", "deploy", "install",
                "modify", "upload", "cancel", "publish", "assign", "revoke", "trigger")


def surface_line(tools):
    """Unique per-server read/write-surface analysis derived from the real tool
    names — content no competitor publishes. Returns '' when no tools."""
    if not tools:
        return ""
    names = [str(t.get("name", "")).lower() for t in tools if isinstance(t, dict)]
    write = [n for n in names if any(v in n for v in _WRITE_VERBS)]
    total = len(names)
    if write:
        ex = ", ".join(f"`{w}`" for w in write[:4])
        return (f"**{len(write)} of {total} advertised tool(s) name a state-changing action** "
                f"({ex}{'…' if len(write) > 4 else ''}). Write-capable tools are the higher-impact "
                "surface if a description is ever poisoned, so they are the ones to re-check on every drift alert.")
    return (f"**All {total} advertised tool(s) read-only by name** — no create/update/delete verbs in "
            "the tool names. A lower-impact surface, though a poisoned read tool can still exfiltrate "
            "or mislead, which is why the static read still matters.")


def render(name, slug, url, vendor, d, today):
    tools = d.get("tools_scanned", 0)
    v = d.get("verdict", "unknown")
    host = urllib.parse.urlparse(url).netloc or url
    # Per-server UNIQUE content (the de-rank fix): fetch the real advertised tool
    # names + descriptions via the same public tools/list read the scan performs.
    # Reuse a pre-fetched list if the caller attached one to d; else fetch here.
    tool_list = d.get("_tools")
    instr = d.get("_instructions", "")
    if tool_list is None:
        try:
            tool_list, instr = fetch_tools(url)
        except Exception:
            tool_list, instr = [], ""
    tools_block = tools_section(name, tool_list, instr)
    surf = surface_line(tool_list)
    surf_bullet = f"- {surf}\n" if surf else ""
    rsum = _clean(d.get("risk_summary"), 240)
    grade = (d.get("grade") or "").strip()
    grade_lead = f"Grade `{grade}` — {rsum}".strip() if grade else (rsum or "").strip()
    if grade_lead and not grade_lead.endswith((".", "!", "?")):
        grade_lead += "."
    # Match the live verify/check output exactly: the badge endpoint returns shields JSON,
    # so it must be wrapped in img.shields.io/endpoint to render as an image in a README.
    badge_endpoint = urllib.parse.quote(f"{BASE}/scan/verify/badge?domain={host}", safe="")
    badge_md = (f"[![MCP security: verified](https://img.shields.io/endpoint?url={badge_endpoint}"
                f"&style=flat-square)]({BASE}/scan/report?url={url})")
    dr = d.get("directory_readiness") or {}
    ready = dr.get("ready")
    bc = dr.get("blocker_count", 0)
    ready_txt = "ready for the Claude Connector Directory" if ready else f"{bc} Claude Directory blocker(s)"
    # Enrich the SEO meta description (the snippet Google shows) with the real advertised
    # tool names when we have them — unique per server, and it matches the long-tail intent
    # ("what does <server> mcp do / is it safe"). Degrade-open to the count-only form.
    _names = [_clean(t.get("name"), 48).replace(":", "").replace('"', "")
              for t in (tool_list or []) if isinstance(t, dict)]
    _names = [n for n in _names if n][:3]
    tool_phrase = f"advertises {', '.join(_names)}; " if _names else ""
    desc = (f"Independent, measured security and Claude Connector Directory readiness scan of the "
            f"{name} MCP server ({url}), run {today}: {tool_phrase}{tools} tools scanned, injection "
            f"verdict '{v}', {ready_txt}. Re-run it yourself in one keyless call.")
    vendor_para = vendor.strip()
    if vendor_para and vendor_para[-1] not in ".!?":
        vendor_para += "."
    body = f"""---
title: Is the {name} MCP server safe? Security & Claude Directory readiness scan
description: {desc}
---
# {name} MCP server — security & directory-readiness scorecard

**Server:** `{url}`
**Scanned:** {today} · **Tools advertised:** {tools} · **Injection verdict:** `{v}` · **Directory:** {ready_txt}

{vendor_para}

When an agent connects {name}, the model reads all {tools} of its advertised tool definition(s)
before any tool runs — so a poisoned description or a hidden instruction in any one of them can steer
the agent first. This scorecard is an independent, static read of exactly that advertised metadata for
`{host}`, scanned {today}; the verdict below is `{v}`.

## What the scan found on {name}

- {verdict_line(d)}
- {readiness_line(d)}
{surf_bullet}
{grade_lead} The scan is **static analysis of the advertised `tools/list` metadata only**:
it never invokes a tool and never sends data anywhere. It is a point-in-time read of the {name} server
on {today}; an MCP server's tool definitions can change at any time (the "drift" risk this scorecard
makes visible), so a clean result today is not a guarantee for tomorrow.

{tools_block}
## Scan {name} yourself, or claim its badge

Re-run this exact {name} check yourself, keyless — the free response carries the verdict and the
directory-blocker count for `{host}`:

```bash
curl "{BASE}/scan/mcp/preview?url={url}&directory=true"
```

For the itemized findings on {name} — which tool, which OWASP LLM01/LLM08 pattern, and which Claude
Directory criteria fail and how to fix each — the zero-egress paid report is one `$0.05 USDC`
[x402](https://x402.org) call: `POST {BASE}/scan/mcp` with `{{"directory":true,"url":"{url}"}}`. If you
run `{host}`, [claim a measured verified-owner badge for {name} free]({BASE}/scan/verify?domain={host})
(one automated DNS-TXT check, no human review) and drop it in your README:

```markdown
{badge_md}
```

Keeping the {name} badge green as its tools change — six-hourly re-scans of `{host}`, drift alerts, the
dated posture-history timeline and the full report — is the `$9.99/mo`
[monitoring subscription]({BASE}/pricing). The claim and the badge are free; a green badge means no
injection patterns were found on the dates shown — a measured signal, not a warranty of safety.

## More

- [Scan any MCP server for prompt injection / tool poisoning](scan-mcp-server-prompt-injection.html)
- [Why was my Claude connector rejected? — directory readiness criteria](claude-connector-directory-readiness.html)
- [All scanned MCP servers](mcp-server-scorecards.html)

Independent scan of `{host}` by [Grey Ridge Signals](https://github.com/rezearcher/greyridge-x402-tools),
measured {today}; re-run the command above for a current result. Questions: contact@greyridgesignals.ai
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
    ap.add_argument("--from-registry", action="store_true",
                    help="also discover live public servers from the MCP registry")
    ap.add_argument("--scan-cap", type=int, default=25,
                    help="max NEW discovered scorecards to publish this run")
    ap.add_argument("--pages", type=int, default=12,
                    help="registry pages (x100) to walk while discovering")
    args = ap.parse_args()
    today = datetime.date.today().isoformat()

    results = []
    seen_urls, seen_slugs = set(), set()
    # curated anchor set first (hand-named for display polish)
    for name, slug, url, vendor in SERVERS:
        parsed = urllib.parse.urlparse(url)
        seen_urls.add((parsed.netloc + parsed.path.rstrip("/")).lower())
        seen_slugs.add(slug)
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

    # runtime-discovered servers from the official registry (the ground-truth roster)
    if args.from_registry:
        for name, slug, url, vendor, d in discover_servers(args.scan_cap, args.pages, seen_urls, seen_slugs):
            body, desc = render(name, slug, url, vendor, d, today)
            results.append((name, slug, url, d, body, desc))

    # index page: a ranked A–F security leaderboard (category-discovery + status-competition
    # surface). Sort BEST-first — grade A>B>C>D>F, then directory-ready before blockers, then
    # lower risk_score. Degrade-open: a result missing grade/risk_score still lists, sorted last,
    # never a broken row. The registry stays the ground-truth roster; the table renders whatever
    # results exist (no hardcoded leaderboard order).
    _GRADE_RANK = {"A": 0, "B": 1, "C": 2, "D": 3, "F": 4}

    def _rank_key(item):
        rd = item[3]
        g = (rd.get("grade") or "").strip().upper()
        dr = rd.get("directory_readiness") or {}
        rs = rd.get("risk_score")
        bc = dr.get("blocker_count")
        return (
            _GRADE_RANK.get(g, 99),
            0 if dr.get("ready") else 1,
            rs if isinstance(rs, (int, float)) else 10 ** 9,
            bc if isinstance(bc, (int, float)) else 10 ** 9,
        )

    ranked = sorted(results, key=_rank_key)
    grade_scale = ""
    table_rows = []
    for name, slug, url, d, body, desc in ranked:
        dr = d.get("directory_readiness") or {}
        grade = (d.get("grade") or "").strip() or "—"
        verdict = d.get("verdict") or "—"
        tools = d.get("tools_scanned", 0)
        if dr.get("ready"):
            directory = "ready"
        else:
            bc = dr.get("blocker_count", 0)
            directory = f"{bc} blocker{'s' if bc != 1 else ''}"
        scanned = (d.get("scanned_at") or today)[:10]
        grade_scale = grade_scale or (d.get("grade_scale") or "")
        table_rows.append(
            f"| [{name}](mcp-{slug}-mcp-security.html) | {grade} | `{verdict}` | "
            f"{tools} | {directory} | {scanned} |")
    table = ("| Server | Grade | Injection | Tools | Claude Directory | Scanned |\n"
             "|---|:--:|---|:--:|---|---|\n" + "\n".join(table_rows))
    grade_scale = grade_scale or (
        "Grey Ridge Signals MCP security grade (A best – F worst), from our risk_score. "
        "Our grade, not a third-party certification.")

    index = f"""---
title: MCP server security ranking — A–F injection & Claude Directory readiness leaderboard
description: Ranked A–F security leaderboard of public MCP servers — static prompt-injection / tool-poisoning grade (OWASP LLM01/LLM08) plus Anthropic Claude Connector Directory readiness, each measured, dated and re-runnable keyless in one call.
---
# MCP server security ranking

A ranked, A–F security read of {len(results)} well-known public MCP servers — graded on the
tool-poisoning / prompt-injection patterns each server advertises (OWASP LLM01/LLM08) and on whether
those tools would pass the Anthropic Claude Connector Directory review criteria. Sorted best-first.
Every row is measured, dated and re-runnable by you in one keyless call; results are point-in-time
(tool definitions drift).

Last generated {today}.

{table}

*{grade_scale}* A `clear` injection verdict means no static tool-poisoning pattern was found — it is
not a guarantee of safety.

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
    # regenerate the sitemap so every scorecard (curated + discovered) is crawlable
    ordered = publish_sitemap(results, today)
    # actively notify IndexNow (Bing/Yandex -> Copilot/ChatGPT/Perplexity) so new pages
    # surface in days, not weeks, without depending on a Googlebot crawl of this surface
    ping_indexnow(ordered)


SITE = "https://rezearcher.github.io/greyridge-x402-tools"
# Static, hand-authored pages on the Pages site (non-scorecard). Kept here so the
# regenerated sitemap never drops them; scorecard URLs are derived from results.
STATIC_PAGES = [
    "", "scan-mcp-server-prompt-injection.html", "claude-connector-directory-readiness.html",
    "mcp-registry-census-2026-10-20.html", "honeypot-check-api-base.html",
    "pre-trade-safety-gate-ai-agents.html", "x402-token-risk-api.html",
    "base-token-safety-price-comparison.html",
    # Line-A per-framework install-intent pages (scripts/gen_line_a_pages.py) — listed here
    # so a scorecard-only sitemap rebuild never starves them of crawl signal.
    "elizaos-token-safety-plugin.html", "vercel-ai-sdk-swap-guard.html",
    "langchain-honeypot-check-tool.html",
]


def _all_published_scorecard_slugs():
    # Ground-truth signal: enumerate every scorecard that actually exists in docs/ right now,
    # not just the ones this (non-deterministic registry-walk) run happened to touch. Without
    # this the sitemap silently drops pages from earlier runs and starves them of crawl signal.
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{DOCS}", "--paginate"],
            stderr=subprocess.DEVNULL, env=ENV)
        names = [x.get("name", "") for x in json.loads(out)]
        return [n[:-3] for n in names
                if n.startswith("mcp-") and n.endswith("-mcp-security.md")]
    except Exception as e:
        print(f"sitemap: could not list docs/ ({e}) -- using this run's results only")
        return []


def publish_sitemap(results, today):
    locs = [f"{SITE}/{p}" for p in STATIC_PAGES]
    locs.append(f"{SITE}/mcp-server-scorecards.html")
    run_slugs = [f"mcp-{slug}-mcp-security" for _, slug, *_ in results]
    for stem in sorted(set(run_slugs) | set(_all_published_scorecard_slugs())):
        locs.append(f"{SITE}/{stem}.html")
    # dedup, preserve order
    seen, ordered = set(), []
    for loc in locs:
        if loc not in seen:
            seen.add(loc)
            ordered.append(loc)
    rows = "\n".join(f"<url><loc>{loc}</loc><lastmod>{today}</lastmod></url>" for loc in ordered)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f"{rows}\n</urlset>\n")
    gh_put(f"{DOCS}/sitemap.xml", xml, f"sitemap: {len(ordered)} URLs incl. all MCP scorecards ({today})")
    print(f"PUT {DOCS}/sitemap.xml ({len(ordered)} urls)")
    return ordered


# IndexNow key (verified file lives at {SITE}/{INDEXNOW_KEY}.txt, confirmed 200). Submitting
# here actively notifies Bing + Yandex (which feed Copilot / ChatGPT search and Perplexity's
# index) the moment a scorecard changes, instead of waiting on a Googlebot crawl that has not
# been reaching this surface. keyLocation is in the same /greyridge-x402-tools/ subtree as every
# submitted URL, so it satisfies the IndexNow directory-scope rule.
INDEXNOW_HOST = "rezearcher.github.io"
INDEXNOW_KEY = "aa3ee6fa313780532656391c0c73664f"


def _load_indexnow_key():
    # Prefer the on-disk key file so a rotation does not require a code edit; fall back to the
    # verified constant. Degrades open — a missing file never silently skips the ping.
    for p in ("outreach/indexnow.key", os.path.join(os.path.dirname(__file__), "..", "outreach", "indexnow.key")):
        try:
            v = open(p).read().strip()
            if v:
                return v
        except OSError:
            continue
    return INDEXNOW_KEY


def ping_indexnow(urls):
    key = _load_indexnow_key()
    payload = json.dumps({
        "host": INDEXNOW_HOST,
        "key": key,
        "keyLocation": f"{SITE}/{key}.txt",
        "urlList": urls,
    }).encode()
    req = urllib.request.Request(
        "https://api.indexnow.org/IndexNow",
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8", **UA},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"IndexNow: submitted {len(urls)} URLs -> HTTP {r.status}")
            return True
    except Exception as e:
        print(f"IndexNow: submit failed ({e}) -- sitemap still updated, non-fatal")
        return False


if __name__ == "__main__":
    ENV = dict(os.environ)
    tok = subprocess.run(["bash", "scripts/gh_token.sh"], capture_output=True, text=True).stdout.strip()
    if tok:
        ENV["GH_TOKEN"] = tok
    main()
