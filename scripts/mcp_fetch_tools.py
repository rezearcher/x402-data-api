#!/usr/bin/env python3
"""Minimal MCP streamable-http client: initialize -> tools/list.
Writes {"tools":[...]} to the given output path (egress.json shape for mcpscan --from-egress).
Usage: mcp_fetch_tools.py <mcp-url> <out.json>
"""
import json, sys, urllib.request

def rpc(url, payload, session=None):
    hdr = {"Content-Type": "application/json",
           "Accept": "application/json, text/event-stream",
           "User-Agent": "greyridge-mcp/1"}
    if session:
        hdr["Mcp-Session-Id"] = session
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=hdr, method="POST")
    resp = urllib.request.urlopen(req, timeout=30)
    sid = resp.headers.get("Mcp-Session-Id") or session
    raw = resp.read().decode("utf-8", "replace")
    # streamable-http may return SSE frames: lines starting "data: {json}"
    body = None
    if raw.lstrip().startswith("{"):
        body = json.loads(raw)
    else:
        for line in raw.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                try:
                    body = json.loads(line[5:].strip()); break
                except Exception:
                    continue
    return body, sid

def main():
    url, out = sys.argv[1], sys.argv[2]
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18",
                       "capabilities": {},
                       "clientInfo": {"name": "greyridge-scan", "version": "1.0"}}}
    body, sid = rpc(url, init)
    # notifications/initialized (best-effort)
    try:
        rpc(url, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}, sid)
    except Exception:
        pass
    tl, sid = rpc(url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, sid)
    tools = (tl or {}).get("result", {}).get("tools", [])
    json.dump({"tools": tools}, open(out, "w"), indent=2)
    print(f"[+] {len(tools)} tools -> {out}")
    for t in tools:
        print("  -", t.get("name"))

if __name__ == "__main__":
    main()
