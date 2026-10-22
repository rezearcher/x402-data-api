#!/usr/bin/env python3
"""Re-scan live public MCP servers (official registry) with the CURRENT enhanced
ruleset (ANSI-escape, CSS-exfil, concealInstr, cross-origin, shadowing...).

The 2026-10 census that found 0% poisoning used the OLD ruleset. This probe asks:
does the enhanced scanner now flag any REAL public server? A hit = a named
maintainer with a concrete security finding = a qualified prospect (the oracle's
"better-qualified prospects" recommendation), not a cold pitch.

Zero self-pay: uses the local offline engine (bin/mcpscan.mjs) only.
"""
import json, subprocess, sys, time, urllib.request, os

CLI = "/home/rez/projects/x402-data-api/.work/greyridge-x402-tools/bin/mcpscan.mjs"
REG = "https://registry.modelcontextprotocol.io/v0/servers?limit=100"
MAX_SERVERS = int(os.environ.get("MAX_SERVERS", "120"))

def fetch_servers():
    seen_names = {}
    url = REG
    cursor = None
    out = []
    pages = 0
    while pages < 6 and len(out) < MAX_SERVERS:
        u = url + (f"&cursor={cursor}" if cursor else "")
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "greyridge-rescan/1"})
            d = json.load(urllib.request.urlopen(req, timeout=25))
        except Exception as e:
            print(f"registry fetch error: {e}", file=sys.stderr); break
        for row in d.get("servers", []):
            s = row.get("server", {})
            meta = row.get("_meta", {}).get("io.modelcontextprotocol.registry/official", {})
            if not meta.get("isLatest"):
                continue
            if meta.get("status") != "active":
                continue
            name = s.get("name")
            remotes = s.get("remotes") or []
            http = [r.get("url") for r in remotes if r.get("type") in ("streamable-http", "sse") and r.get("url")]
            if not http or not name:
                continue
            # dedup by name, keep first http url
            if name in seen_names:
                continue
            seen_names[name] = http[0]
            out.append({"name": name, "url": http[0], "title": s.get("title"), "desc": s.get("description", "")[:80]})
        cursor = d.get("metadata", {}).get("nextCursor")
        pages += 1
        if not cursor:
            break
    return out[:MAX_SERVERS]

def scan(url):
    try:
        p = subprocess.run(["node", CLI, url], capture_output=True, text=True, timeout=55)
        txt = p.stdout.strip() or p.stderr.strip()
        try:
            return json.loads(txt)
        except Exception:
            return {"error": txt[:160] or "no output"}
    except subprocess.TimeoutExpired:
        return {"error": "timeout"}
    except Exception as e:
        return {"error": str(e)[:160]}

def main():
    servers = fetch_servers()
    print(f"[+] {len(servers)} latest/active servers with HTTP remotes\n")
    stats = {"auth": 0, "unreachable": 0, "scanned": 0, "flagged": 0,
             "clean_with_tools": 0, "clean_empty": 0, "total_tools_scanned": 0}
    findings = []
    clean_examples = []
    for i, s in enumerate(servers):
        res = scan(s["url"])
        err = res.get("error")
        if err:
            low = err.lower()
            if "auth" in low or "401" in low or "403" in low:
                stats["auth"] += 1; tag = "AUTH"
            else:
                stats["unreachable"] += 1; tag = "ERR"
        else:
            stats["scanned"] += 1
            # scanner report shape: tools_scanned + verdict + risk_score + findings[]
            fnd = res.get("findings") or []
            risk = res.get("risk_score", res.get("risk", 0)) or 0
            verdict = res.get("verdict")
            ntools = res.get("tools_scanned", 0) or 0
            stats["total_tools_scanned"] += ntools
            if fnd or (isinstance(risk, (int, float)) and risk > 0) or verdict in ("block", "review", "warn"):
                stats["flagged"] += 1
                tag = f"FLAG risk={risk} verdict={verdict} tools={ntools}"
                findings.append({"server": s, "report": res})
            elif ntools > 0:
                stats["clean_with_tools"] += 1
                clean_examples.append({"name": s["name"], "url": s["url"], "tools": ntools})
                tag = f"clean ({ntools} tools)"
            else:
                stats["clean_empty"] += 1
                tag = "clean (0 tools)"
        print(f"  [{i+1}/{len(servers)}] {tag:28s} {s['name']}")
        time.sleep(0.2)
    print("\n=== SUMMARY ===")
    print(json.dumps(stats, indent=2))
    if findings:
        print("\n=== FLAGGED (qualified prospects — real finding in a live public server) ===")
        print(json.dumps(findings, indent=2)[:6000])
    out = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "stats": stats,
           "n_servers": len(servers), "findings": findings,
           "clean_examples": clean_examples[:40]}
    with open("/home/rez/projects/x402-data-api/data/live_registry_rescan.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\nwrote data/live_registry_rescan.json")

if __name__ == "__main__":
    main()
