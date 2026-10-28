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
import argparse, base64, json, re, subprocess, sys, urllib.parse, urllib.request, datetime, os

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
    """Yield (title, description, url, repo_url, packages) for active, latest registry
    entries that advertise a remote HTTP endpoint. The registry is the ground-truth
    roster. repo_url is the server's declared source repository (repository.url) and
    packages is its declared publish artifacts (packages[] with registryType +
    identifier) — both feed the maintenance + supply-chain drift grade. Either may be
    None/[] (the grade degrades open to UNKNOWN, never a false F)."""
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
            repo_url = ((srv.get("repository") or {}).get("url") or "").strip() or None
            packages = []
            for pkg in (srv.get("packages") or []):
                if not isinstance(pkg, dict):
                    continue
                ident = (pkg.get("identifier") or pkg.get("name") or "").strip()
                if ident:
                    packages.append({"registryType": pkg.get("registryType") or pkg.get("registry_type"),
                                     "identifier": ident})
            for rem in (srv.get("remotes") or []):
                url = rem.get("url", "")
                if rem.get("type") in ("streamable-http", "http", "sse") and url.startswith("http"):
                    yield srv.get("title"), srv.get("description"), url, repo_url, packages
                    break
        cursor = (d.get("metadata") or {}).get("nextCursor")
        if not cursor:
            return


def _has_substance(tool_list):
    """True when a discovered server advertises enough describable surface to make a
    genuinely unique, non-boilerplate scorecard page. The bar: at least one tool with a
    real name AND a non-trivial description, or at least two distinctly-named tools. A
    server whose entire tools/list is one bare, undescribed name produces a page that is
    ~all shared boilerplate — exactly the thin / scaled-content pattern Google de-ranks
    at the site level, so we skip it rather than risk the valuable pages. Degrade-open:
    an empty list (fetch failed) returns False (skip), never a crash."""
    named = []
    for t in (tool_list or []):
        if not isinstance(t, dict):
            continue
        nm = str(t.get("name", "")).strip()
        if not nm:
            continue
        named.append(nm)
        desc = str(t.get("description", "")).strip()
        if len(desc) >= 20:
            return True
    return len(set(n.lower() for n in named)) >= 2


# --- Maintenance + supply-chain drift grade --------------------------------
# The recurring-value dimension no one-shot competitor (Glama has no maintenance
# grade; Snyk/mcp-scan is one-shot) covers: an MCP server's STATIC tool metadata can
# be clean today while its source repo goes abandoned or its upstream package ships a
# CVE next week. We grade two live, keyless signals — repo maintenance (GitHub unauth
# /repos) and declared-package advisories (OSV + npm deprecated) — and persist them so
# a re-scan that finds a NEW advisory or a worsened maintenance bucket is a DRIFT event
# feeding the subscription-gated monitored badge. Everything here degrades OPEN: any API
# miss or absent repo/packages yields UNKNOWN (neutral), never a fabricated F.

def _parse_iso(s):
    """Parse an ISO-8601 timestamp (GitHub's pushed_at, Z or offset) to an aware UTC
    datetime, or None. Degrade-open: never raises."""
    if not s or not isinstance(s, str):
        return None
    t = s.strip().replace("Z", "+00:00")
    try:
        dt = datetime.datetime.fromisoformat(t)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def parse_github_repo_url(url):
    """(owner, repo) from a GitHub repository.url, or None for non-GitHub / unparseable.
    Tolerates .git suffix, trailing slash, and extra path segments."""
    if not url or not isinstance(url, str):
        return None
    try:
        p = urllib.parse.urlparse(url.strip())
    except Exception:
        return None
    if p.netloc.lower() not in ("github.com", "www.github.com"):
        return None
    parts = [x for x in p.path.split("/") if x]
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not owner or not repo:
        return None
    return owner, repo


def maintenance_bucket(repo_meta, now=None):
    """Grade repository maintenance from a GitHub /repos payload (or None). Buckets:
    archived|disabled -> ABANDONED (F); last push <30d -> fresh (A); 30-180d -> active
    (B); 180-365d -> slowing (C); >365d -> stale (D); no repo / no push date -> UNKNOWN
    (grade None, neutral). Pure + degrade-open."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if not isinstance(repo_meta, dict):
        return {"bucket": "UNKNOWN", "grade": None,
                "reason": "no public source repository to measure maintenance from"}
    if repo_meta.get("archived") or repo_meta.get("disabled"):
        return {"bucket": "ABANDONED", "grade": "F",
                "reason": "the source repository is archived or disabled"}
    dt = _parse_iso(repo_meta.get("pushed_at"))
    if not dt:
        return {"bucket": "UNKNOWN", "grade": None,
                "reason": "the source repository reports no last-push date"}
    days = max(0, (now - dt).days)
    oi = repo_meta.get("open_issues_count")
    if days < 30:
        bucket, grade = "fresh", "A"
    elif days < 180:
        bucket, grade = "active", "B"
    elif days < 365:
        bucket, grade = "slowing", "C"
    else:
        bucket, grade = "stale", "D"
    reason = f"last commit pushed {days} day(s) ago"
    if isinstance(oi, int):
        reason += f", {oi} open issue(s)"
    return {"bucket": bucket, "grade": grade, "reason": reason,
            "days_since_push": days, "open_issues": oi if isinstance(oi, int) else None}


def supplychain_grade(vuln_ids, deprecated_pkgs, had_packages=True):
    """Grade declared-package supply-chain risk. OSV querybatch returns advisory IDs
    only (no severity), so we grade on COUNT: 0 advisories + not deprecated = clean (A);
    1-2 = CAUTION (C); 3+ = HIGH (D). A deprecated latest version alone = CAUTION. No
    declared packages = UNKNOWN (grade None). Pure + degrade-open."""
    ids = sorted({v for v in (vuln_ids or []) if v})
    dep = sorted({d for d in (deprecated_pkgs or []) if d})
    if not had_packages:
        return {"level": "UNKNOWN", "grade": None, "vuln_ids": ids,
                "deprecated": dep, "advisory_count": 0}
    n = len(ids)
    if n >= 3:
        level, grade = "HIGH", "D"
    elif n >= 1:
        level, grade = "CAUTION", "C"
    elif dep:
        level, grade = "CAUTION", "C"
    else:
        level, grade = "clean", "A"
    return {"level": level, "grade": grade, "vuln_ids": ids,
            "deprecated": dep, "advisory_count": n}


def _osv_ecosystem(registry_type):
    """Map an MCP-registry packages[].registryType to an OSV ecosystem, or None if OSV
    does not index it (we skip those packages rather than guess)."""
    return {
        "npm": "npm", "pypi": "PyPI", "nuget": "NuGet", "gem": "RubyGems",
        "rubygems": "RubyGems", "golang": "Go", "go": "Go", "cargo": "crates.io",
        "crates": "crates.io", "maven": "Maven", "composer": "Packagist",
    }.get((registry_type or "").lower())


def osv_querybatch(packages):
    """ONE keyless POST to OSV querybatch for every OSV-indexable declared package;
    return the flat list of advisory IDs (GHSA/PYSEC/...). Degrade-open: [] on any miss."""
    queries, labels = [], []
    for p in (packages or []):
        eco = _osv_ecosystem(p.get("registryType"))
        name = (p.get("identifier") or "").strip()
        if eco and name:
            queries.append({"package": {"name": name, "ecosystem": eco}})
            labels.append(name)
    if not queries:
        return []
    body = json.dumps({"queries": queries}).encode()
    req = urllib.request.Request("https://api.osv.dev/v1/querybatch", data=body,
                                 headers={**UA, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            d = json.load(r)
    except Exception as e:
        print(f"  osv miss ({len(queries)} pkg): {e}", file=sys.stderr)
        return []
    ids = []
    for res in d.get("results", []):
        for v in (res.get("vulns") or []):
            if v.get("id"):
                ids.append(v["id"])
    return ids


def npm_deprecated(packages):
    """Return npm package names whose dist-tags.latest version is deprecated (a real
    'do not use' maintenance signal). Keyless GET per npm package; degrade-open."""
    dep = []
    for p in (packages or []):
        if (p.get("registryType") or "").lower() != "npm":
            continue
        name = (p.get("identifier") or "").strip()
        if not name:
            continue
        try:
            q = f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='@/')}"
            with urllib.request.urlopen(urllib.request.Request(q, headers=UA), timeout=20) as r:
                d = json.load(r)
            latest = (d.get("dist-tags") or {}).get("latest") or ""
            ver = (d.get("versions") or {}).get(latest, {})
            if isinstance(ver, dict) and ver.get("deprecated"):
                dep.append(name)
        except Exception as e:
            print(f"  npm-deprecated miss {name}: {e}", file=sys.stderr)
            continue
    return dep


def fetch_repo_meta(owner, repo):
    """GitHub unauth GET /repos/{owner}/{repo} (60/hr, >= our scan-cap). Degrade-open: None."""
    q = f"https://api.github.com/repos/{owner}/{repo}"
    req = urllib.request.Request(q, headers={**UA, "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except Exception as e:
        print(f"  repo-meta miss {owner}/{repo}: {e}", file=sys.stderr)
        return None


def assess_maintenance(repo_url):
    """Resolve + grade repo maintenance from a declared repository.url. Degrade-open."""
    gh = parse_github_repo_url(repo_url)
    if not gh:
        return maintenance_bucket(None)
    return maintenance_bucket(fetch_repo_meta(*gh))


def assess_supplychain(packages):
    """Grade declared-package supply-chain risk live (OSV + npm deprecated). Degrade-open."""
    had = bool(packages)
    ids = osv_querybatch(packages) if had else []
    dep = npm_deprecated(packages) if had else []
    return supplychain_grade(ids, dep, had_packages=had)


def maintenance_section(name, host, maint, supply):
    """Render the maintenance + supply-chain block for a scorecard page. This is the
    continuous-risk dimension a one-shot scan (Glama, Snyk mcp-scan) cannot see, and the
    drift alert on it is the subscription-gated recurring value. Claims Law: every line
    is a measured, dated read; UNKNOWN is stated plainly, never dressed as a pass."""
    maint = maint or {"bucket": "UNKNOWN", "grade": None,
                      "reason": "no public source repository to measure maintenance from"}
    supply = supply or {"level": "UNKNOWN", "grade": None, "vuln_ids": [],
                        "deprecated": [], "advisory_count": 0}
    lines = []
    mg = maint.get("grade")
    if mg:
        lines.append(f"- **Maintenance grade `{mg}`** — {maint['reason']}.")
    else:
        lines.append(f"- **Maintenance: not measurable** — {maint['reason']} "
                     "(no grade asserted either way).")
    sg = supply.get("grade")
    ids = supply.get("vuln_ids") or []
    dep = supply.get("deprecated") or []
    if supply.get("level") == "UNKNOWN":
        lines.append("- **Supply chain: not measurable** — this server declares no "
                     "published package to trace upstream advisories against.")
    elif supply.get("level") == "clean":
        lines.append("- **Supply chain grade `A`** — no known advisory (OSV) and no "
                     "deprecated release across the package(s) this server publishes.")
    else:
        bits = []
        if ids:
            shown = ", ".join(ids[:4]) + ("…" if len(ids) > 4 else "")
            bits.append(f"{len(ids)} known upstream advisory/advisories ({shown})")
        if dep:
            bits.append(f"a deprecated latest release on {', '.join(dep[:3])}")
        detail = "; ".join(bits) if bits else "a flagged upstream condition"
        lines.append(f"- **Supply chain grade `{sg}` ({supply.get('level')})** — {detail}.")
    body = (
        f"## Maintenance & supply-chain — the risk {name}'s static scan can't see\n\n"
        f"A prompt-injection scan reads {name}'s advertised tool metadata at one moment. "
        "It cannot tell you the project behind `" + host + "` went quiet, or that a package it "
        "ships picked up a CVE last week — the two ways a server that scanned clean becomes a "
        "liability without its tool definitions changing at all. These are measured, dated reads:\n\n"
        + "\n".join(lines) + "\n\n"
        "A one-shot scan (and the free one-shot competitors) can only ever show the snapshot above. "
        f"The value in watching `{host}` is the **change**: the alert the week its upstream ships an "
        "advisory, or the month its repo crosses from active into stale. That continuous drift watch — "
        "six-hourly re-checks of all three signals with an alert on any worsening — is the "
        f"[`$9.99/mo` monitoring subscription]({BASE}/pricing). A grade here is a point-in-time "
        "measurement, not a warranty.\n"
    )
    return body


def discover_servers(scan_cap, pages, seen_urls, seen_slugs):
    """Discover live public MCP servers from the registry and keep only those that
    answer an unauthenticated tools/list with describable surface (see _has_substance).
    Returns scored tuples (name, slug, url, vendor, d) ready to render; d carries the
    pre-fetched _tools/_instructions so render() does not re-fetch. Bounded by scan_cap."""
    out = []
    checked = 0
    for title, desc, url, repo_url, packages in _fetch_registry(pages):
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
        # Substance floor (anti-thin-content / scaled-content-abuse guard): a scorecard
        # earns a crawlable page only if the server advertises real, describable surface.
        # We fetch the tools/list ONCE here and attach it to d so render() reuses it (no
        # double MCP round-trip), then require at least one named+described tool OR two
        # named tools — a page whose entire uniqueness is a single bare tool name is pure
        # boilerplate and only adds Google scaled-content risk to the whole Pages site.
        try:
            tool_list, instr = fetch_tools(url)
        except Exception:
            tool_list, instr = [], ""
        d["_tools"] = tool_list
        d["_instructions"] = instr
        if not _has_substance(tool_list):
            print(f"  discover THIN-SKIP {name} ({host}): "
                  f"{len(tool_list)} tool(s), no describable surface", file=sys.stderr)
            continue
        # Maintenance + supply-chain drift grade (keyless, degrade-open): resolve the
        # declared source repo + published packages into measured maintenance and
        # upstream-advisory reads. Attached to d so render() and future drift re-scans
        # consume them without re-fetching. Any miss -> UNKNOWN, never a false F.
        d["_repo_url"] = repo_url
        d["_packages"] = packages
        d["_maintenance"] = assess_maintenance(repo_url)
        d["_supplychain"] = assess_supplychain(packages)
        seen_slugs.add(slug)
        out.append((name, slug, url, vendor, d))
        print(f"  discover OK {name} ({host}): tools={d.get('tools_scanned')} "
              f"maint={d['_maintenance'].get('bucket')} supply={d['_supplychain'].get('level')} "
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
    # Severity-aware (Claims Law): distinguish hard rejects from quality-polish mediums,
    # matching the live /scan/mcp/preview teaser. Calling a soft-only result a "blocker that
    # would fail" is an oversell — the Directory reviews those items for quality, not rejection.
    hard = dr.get("hard_blockers")
    soft = dr.get("soft_blockers")
    status = dr.get("status")
    if hard is None and soft is None:  # older scan payload — degrade to the count-only form
        return (f"**Claude Connector Directory readiness: {bc} item(s) to review.** This server advertises "
                f"{bc} tool definition(s) that miss Anthropic's structural review criteria. The Connector "
                "Directory review runs about 20 days — the itemized list of which criteria and how to fix "
                "each is one paid call away.")
    if status == "needs_polish" or (hard == 0 and (soft or 0) > 0):
        return (f"**Claude Connector Directory readiness: {soft} quality item(s) to polish.** No hard "
                "rejects — but this server advertises tool definition(s) that miss quality criteria "
                "Anthropic reviews (titles, read-only hints, descriptions). These don't auto-reject, yet "
                "the review runs about 20 days, so polishing them first avoids a slow round-trip. The "
                "itemized list and how to fix each is one paid call away.")
    return (f"**Claude Connector Directory readiness: {hard} likely reject(s).** This server advertises "
            f"{hard} tool definition(s) that would likely fail Anthropic's structural review criteria"
            + (f" (plus {soft} quality item(s) to polish)" if soft else "")
            + ". The Connector Directory review runs about 20 days, so a rejection is expensive — the "
            "itemized list of which criteria fail, and how to fix each, is one paid call away.")


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
    # Maintenance + supply-chain drift grade (the continuous-risk dimension no one-shot
    # competitor covers). Discovery attaches these to d; curated anchors have no declared
    # repo/packages so they degrade open to UNKNOWN (stated plainly, never a false F).
    maint_block = maintenance_section(name, host, d.get("_maintenance"), d.get("_supplychain"))
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
    _hard = dr.get("hard_blockers")
    _soft = dr.get("soft_blockers")
    if ready:
        ready_txt = "ready for the Claude Connector Directory"
    elif _hard == 0 and (_soft or 0) > 0:
        ready_txt = f"{_soft} Claude Directory quality item(s) to polish (no hard rejects)"
    elif _hard:
        ready_txt = f"{_hard} likely Claude Directory reject(s)"
    else:
        ready_txt = f"{bc} Claude Directory item(s) to review"
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
    # Quote the frontmatter scalars: both the description and the title can contain a
    # ": " (e.g. "...run <date>: advertises...") or a server name with a colon ("Plant
    # Guide: Dubai..."), which silently breaks YAML parsing and makes jekyll-seo-tag fall
    # back to the generic SITE description/title. Double-quote and escape internal quotes.
    title_yaml = f"Is the {name} MCP server safe? Security & Claude Directory readiness scan".replace('"', "'")
    desc_yaml = desc.replace('"', "'")
    body = f"""---
title: "{title_yaml}"
description: "{desc_yaml}"
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
{maint_block}
## Scan {name} yourself, or claim its badge {{#claim}}

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


def gh_get_text(path):
    """Fetch and decode a file's content from the publish repo, or None if absent."""
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{path}"],
            stderr=subprocess.DEVNULL, env=ENV)
        j = json.loads(out)
        return base64.b64decode(j.get("content", "")).decode("utf-8", "replace")
    except Exception:
        return None


# --- Leaderboard carry-forward ---------------------------------------------
# The ranked index page is a UNION of every scorecard ever published, not just the
# ones this (non-deterministic registry-walk) run happened to reach. Without this a
# server that 502s for one run silently drops off the ranked hub while its page +
# sitemap entry persist (a sitemap-only orphan) — the leaderboard flaps and shrinks
# run to run. State lives in docs/scorecard-index.json in the publish repo (the only
# place that survives across the stateless weekly cron); each run merges this-run
# cards OVER the prior map, so the hub only ever grows. Every row carries its OWN
# scan date, so carried-forward rows are honestly dated (Claims Law) — point-in-time,
# not a fresh claim.
_GRADE_RANK = {"A": 0, "B": 1, "C": 2, "D": 3, "F": 4}
LEADER_STATE = f"{DOCS}/scorecard-index.json"


def card_from_result(name, slug, url, d, today):
    """Normalize a live scan result into the compact leaderboard card shape."""
    dr = d.get("directory_readiness") or {}
    rs = d.get("risk_score")
    return {
        "name": name, "slug": slug, "url": url,
        "grade": ((d.get("grade") or "").strip() or None),
        "verdict": (d.get("verdict") or None),
        "tools": d.get("tools_scanned", 0),
        "ready": bool(dr.get("ready")),
        "blocker_count": dr.get("blocker_count"),
        "risk_score": rs if isinstance(rs, (int, float)) else None,
        "grade_scale": d.get("grade_scale") or "",
        "scanned": (d.get("scanned_at") or today)[:10],
    }


def parse_published_card(slug, text):
    """Recover a leaderboard card from an already-published scorecard page.

    Parses the stable rendered lines (`**Scanned:** ... · **Tools advertised:** ...
    · **Injection verdict:** `v` · **Directory:** ...` and a `Grade `X`` lead).
    Degrades open: any field it cannot read is None/0 and the row still lists
    (sorted last), never a crash or a fabricated value."""
    name, url, grade, verdict, scanned = slug, None, None, None, None
    tools, ready, bc = 0, False, None
    m = re.search(r"^# (.+?) MCP server\b", text, re.M)
    if m:
        name = m.group(1).strip()
    m = re.search(r"\*\*Server:\*\*\s*`([^`]+)`", text)
    if m:
        url = m.group(1).strip()
    m = re.search(
        r"\*\*Scanned:\*\*\s*([\d-]+)\s*·\s*\*\*Tools advertised:\*\*\s*(\d+)\s*·\s*"
        r"\*\*Injection verdict:\*\*\s*`([^`]*)`\s*·\s*\*\*Directory:\*\*\s*(.+)", text)
    if m:
        scanned, tools, verdict = m.group(1), int(m.group(2)), m.group(3)
        dirtxt = m.group(4).strip()
        if dirtxt.lower().startswith("ready"):
            ready, bc = True, 0
        else:
            mm = re.match(r"(\d+)", dirtxt)
            bc = int(mm.group(1)) if mm else None
    m = re.search(r"Grade `([A-F])`", text)
    if m:
        grade = m.group(1)
    return {
        "name": name, "slug": slug, "url": url, "grade": grade, "verdict": verdict,
        "tools": tools, "ready": ready, "blocker_count": bc,
        "risk_score": None, "grade_scale": "", "scanned": scanned,
    }


def grade_cell_link(grade, page):
    """Leaderboard Grade cell: deep-link the grade to that server's claim/fix CTA
    (the #claim anchor on its per-server page), not just the row name to the page top.
    The grade is the cell a server owner reacts to ("why am I a C?"), so it is the
    highest-intent entry into the free-badge claim + $9.99/mo fix path. A missing grade
    ("—" or empty) stays plain text so a carried-forward row with no grade is never a
    dead link. Degrade-open: anything falsy or the em-dash placeholder passes through."""
    g = (grade or "").strip()
    if not g or g == "—":
        return grade
    return f"[{g}]({page}#claim)"


def rank_key_card(c):
    g = (c.get("grade") or "").strip().upper()
    rs = c.get("risk_score")
    bc = c.get("blocker_count")
    return (
        _GRADE_RANK.get(g, 99),
        0 if c.get("ready") else 1,
        rs if isinstance(rs, (int, float)) else 10 ** 9,
        bc if isinstance(bc, (int, float)) else 10 ** 9,
    )


def _load_leader_state():
    t = gh_get_text(LEADER_STATE)
    if not t:
        return {}
    try:
        d = json.loads(t)
        cards = d.get("cards", d) if isinstance(d, dict) else {}
        return cards if isinstance(cards, dict) else {}
    except Exception:
        return {}


def select_stale_rescan(state, done_slugs, limit):
    """Pick the stalest carried-forward cards to re-scan this run. Pure + testable.

    - only cards with a usable http(s) url (we need something live to re-scan);
    - never a slug already scanned this run (no double work, discovery wins);
    - stalest first: oldest `scanned` date ascending; a missing/blank date sorts
      OLDEST (it is maximally stale), slug as the deterministic tie-break.
    Returns a list of card dicts, length <= max(limit, 0).
    """
    if limit <= 0:
        return []
    done = set(done_slugs or ())
    cands = [c for s, c in (state or {}).items()
             if s not in done and str(c.get("url") or "").startswith("http")]
    cands.sort(key=lambda c: (str(c.get("scanned") or ""), str(c.get("slug") or "")))
    return cands[:limit]


def build_leaderboard(run_cards, publish, today):
    """Merge this run's cards over the persisted state (+ one-time/self-healing
    backfill from any published page missing from state), newest wins. Returns
    (merged_cards_by_slug, did_backfill). Dry-run stays offline → run cards only."""
    if not publish:
        return dict(run_cards), False
    state = _load_leader_state()
    known = set(state) | set(run_cards)
    backfilled = False
    for stem in _all_published_scorecard_slugs():
        # stem == f"mcp-{slug}-mcp-security"
        if not (stem.startswith("mcp-") and stem.endswith("-mcp-security")):
            continue
        slug = stem[len("mcp-"):-len("-mcp-security")]
        if slug in known:
            continue
        txt = gh_get_text(f"{DOCS}/{stem}.md")
        if not txt:
            continue
        state[slug] = parse_published_card(slug, txt)
        backfilled = True
    merged = dict(state)
    merged.update(run_cards)  # this run's fresh data wins on conflict
    return merged, backfilled


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
    ap.add_argument("--rescan-stale", type=int, default=0,
                    help="also re-scan the N stalest carried-forward scorecards this run "
                         "(freshness rotation: keeps the whole corpus current for SEO + makes "
                         "the continuous-monitoring claim true on the public hub, not just "
                         "claimed; also catches tool-definition drift). Needs --publish; 0 off.")
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

    # Freshness rotation: re-scan the stalest carried-forward cards so the WHOLE corpus
    # stays current, not just the handful a given registry walk reaches. This sustains SEO
    # ranking (Google de-ranks a page that is a static photo of an old scan), makes the
    # continuous-monitoring claim true on the public hub rather than merely asserted, and
    # catches tool-definition drift (a server that changed its tools gets a fresh verdict).
    # Degrade-open: a card that 502s or returns no tools stays carried with its prior data
    # and date — never dropped, never a fabricated fresh date. Needs state (publish repo).
    if args.publish and not args.dry_run and args.rescan_stale > 0:
        state = _load_leader_state()
        done_slugs = {slug for _, slug, *_ in results}
        stale = select_stale_rescan(state, done_slugs, args.rescan_stale)
        print(f"freshness: {len(stale)} stalest card(s) selected to re-scan "
              f"(of {len(state)} carried)", file=sys.stderr)
        for c in stale:
            slug = c["slug"]
            url = c["url"]
            name = c.get("name") or slug
            try:
                d = scan(url)
            except Exception as e:
                print(f"STALE-SKIP {name} ({url}): {e} — carried", file=sys.stderr)
                continue
            if d.get("tools_scanned", 0) < 1:
                print(f"STALE-SKIP {name}: no tools returned — carried", file=sys.stderr)
                continue
            body, desc = render(name, slug, url, c.get("vendor") or "", d, today)
            results.append((name, slug, url, d, body, desc))
            print(f"RESCAN {name}: {c.get('scanned')} -> {today} "
                  f"verdict={d.get('verdict')} grade={d.get('grade')}")

    # index page: a ranked A–F security leaderboard (category-discovery + status-competition
    # surface). Sort BEST-first — grade A>B>C>D>F, then directory-ready before blockers, then
    # lower risk_score. Degrade-open: a card missing grade/risk_score still lists, sorted last,
    # never a broken row. The leaderboard is the UNION of every scorecard ever published
    # (persisted state + this run), so a server that 502s for one run is carried forward with
    # its last measured data + date rather than vanishing from the hub.
    run_cards = {slug: card_from_result(name, slug, url, d, today)
                 for name, slug, url, d, body, desc in results}
    merged, backfilled = build_leaderboard(run_cards, args.publish and not args.dry_run, today)
    if backfilled:
        print(f"leaderboard: backfilled prior-published servers into state "
              f"({len(merged)} total)", file=sys.stderr)

    ranked = sorted(merged.values(), key=rank_key_card)
    grade_scale = ""
    table_rows = []
    for c in ranked:
        grade = (c.get("grade") or "").strip() or "—"
        verdict = c.get("verdict") or "—"
        tools = c.get("tools", 0)
        if c.get("ready"):
            directory = "ready"
        else:
            bc = c.get("blocker_count")
            bc = bc if isinstance(bc, int) else 0
            directory = f"{bc} blocker{'s' if bc != 1 else ''}"
        scanned = (c.get("scanned") or today)[:10]
        grade_scale = grade_scale or (c.get("grade_scale") or "")
        page = f"mcp-{c['slug']}-mcp-security.html"
        table_rows.append(
            f"| [{c.get('name') or c['slug']}]({page}) | {grade_cell_link(grade, page)} | "
            f"`{verdict}` | {tools} | {directory} | {scanned} |")
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

A ranked, A–F security read of {len(merged)} well-known public MCP servers — graded on the
tool-poisoning / prompt-injection patterns each server advertises (OWASP LLM01/LLM08) and on whether
those tools would pass the Anthropic Claude Connector Directory review criteria. Sorted best-first.
Every row is measured, dated and re-runnable by you in one keyless call; results are point-in-time
(tool definitions drift) — each row shows the date it was last scanned.

Last generated {today}.

{table}

*{grade_scale}* A `clear` injection verdict means no static tool-poisoning pattern was found — it is
not a guarantee of safety.

## Is your MCP server on this list?

Scan it free and see where it ranks — paste your `tools/list` into the
[browser scanner]({BASE}/scan/mcp-scanner) (it runs against a zero-egress endpoint, so your server
stays private), or re-run any row from the terminal, keyless:

```bash
curl "{BASE}/scan/mcp/preview?url=https://your-mcp-host/mcp&directory=true"
```

If you run the server, [claim a measured verified-owner badge]({BASE}/scan/verify) free — one automated
DNS-TXT check, no human review — and embed it in your README so your users can see the grade for
themselves. Keeping that badge green as your tools change — six-hourly re-scans, drift alerts and the
full OWASP LLM01/LLM08 report — is the [`$9.99/mo` monitoring subscription]({BASE}/pricing). A green
badge means no injection patterns were found on the dates shown: a measured signal, not a warranty.

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
           f"scorecards: ranked leaderboard of {len(merged)} MCP server security scorecards "
           f"({len(run_cards)} re-scanned this run, {today})")
    print(f"PUT {DOCS}/mcp-server-scorecards.md ({len(merged)} ranked, {len(run_cards)} fresh)")
    # Persist the merged leaderboard so the next (stateless cron) run carries forward every
    # server, not just the ones its registry walk happens to reach — the hub only grows.
    gh_put(LEADER_STATE,
           json.dumps({"updated": today, "cards": merged}, sort_keys=True, indent=0),
           f"scorecards: leaderboard index state — {len(merged)} servers ({today})")
    print(f"PUT {LEADER_STATE} ({len(merged)} cards)")
    # Compact, pre-ranked Top-25 the Worker's embeddable leaderboard widget
    # (/scan/leaderboard.svg) fetches — a small, cache-cheap payload so the billboard
    # SVG renders fast on every third-party embed without parsing the full index.
    # The Worker degrades open to scorecard-index.json if this is ever absent.
    top = [{
        "name": c.get("name"), "slug": c.get("slug"), "url": c.get("url"),
        "grade": c.get("grade"), "verdict": c.get("verdict"),
        "risk_score": c.get("risk_score"), "blocker_count": c.get("blocker_count"),
        "ready": bool(c.get("ready")), "scanned": c.get("scanned"),
    } for c in ranked[:25]]
    gh_put(f"{DOCS}/leaderboard.json",
           json.dumps({"updated": today, "hub": "mcp-server-scorecards.html",
                       "count": len(merged), "leaderboard": top}, indent=0),
           f"scorecards: compact Top-25 leaderboard.json for the embed widget ({today})")
    print(f"PUT {DOCS}/leaderboard.json (top {len(top)} of {len(merged)})")
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
