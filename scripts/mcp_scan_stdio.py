#!/usr/bin/env python3
"""Scan an MCP server's advertised tools with Grey Ridge's free preview.

Works for stdio servers and auth-gated HTTP servers: only the tools/list
metadata (names, descriptions, schemas) is sent; no tool is ever called.

  stdio:  mcp_scan_stdio.py -- npx -y @modelcontextprotocol/server-everything
  http:   mcp_scan_stdio.py --url https://host/mcp --header 'Authorization: Bearer X'
  file:   mcp_scan_stdio.py --file tools_list.json   # {"tools":[...]} or a bare array
  --dry   print the payload instead of POSTing it
"""
import argparse, json, subprocess, sys, urllib.request

B = "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview"

def stdio_tools(cmd):
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, text=True)
    def send(o): p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()
    def recv(i):
        for line in p.stdout:
            try: m = json.loads(line)
            except ValueError: continue
            if m.get("id") == i: return m
    send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-03-26", "capabilities": {},
        "clientInfo": {"name": "mcp-scan-stdio", "version": "0.1"}}})
    recv(1)
    send({"jsonrpc": "2.0", "method": "notifications/initialized"})
    tools, cur = [], None
    while True:
        send({"jsonrpc": "2.0", "id": 2, "method": "tools/list",
              "params": {"cursor": cur} if cur else {}})
        r = recv(2)["result"]; tools += r.get("tools", []); cur = r.get("nextCursor")
        if not cur: break
    p.terminate()
    return tools

def http_tools(url, headers):
    def post(o, sid=None):
        h = {"user-agent": "mcp-scan-stdio/0.1", "content-type": "application/json", "accept": "application/json, text/event-stream", **headers}
        if sid: h["mcp-session-id"] = sid
        rq = urllib.request.Request(url, json.dumps(o).encode(), h)
        with urllib.request.urlopen(rq, timeout=30) as r:
            body = r.read().decode(); sid = r.headers.get("mcp-session-id", sid)
        for ln in body.splitlines():
            ln = ln[5:].strip() if ln.startswith("data:") else ln.strip()
            if ln.startswith("{"): return json.loads(ln), sid
        return {}, sid
    _, sid = post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-03-26", "capabilities": {},
        "clientInfo": {"name": "mcp-scan-stdio", "version": "0.1"}}})
    try: post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    except Exception: pass
    m, _ = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, sid)
    return m["result"]["tools"]

ap = argparse.ArgumentParser(); ap.add_argument("--url"); ap.add_argument("--file")
ap.add_argument("--header", action="append", default=[]); ap.add_argument("--dry", action="store_true")
ap.add_argument("cmd", nargs=argparse.REMAINDER)
a = ap.parse_args()
cmd = [c for c in a.cmd if c != "--"]
if a.file:
    d = json.load(open(a.file)); tools = d["tools"] if isinstance(d, dict) else d
elif a.url:
    tools = http_tools(a.url, dict(h.split(": ", 1) for h in a.header))
elif cmd:
    tools = stdio_tools(cmd)
else:
    ap.error("give a command after --, or --url, or --file")
payload = json.dumps({"tools": tools})
print(f"tools_listed={len(tools)} bytes={len(payload)}", file=sys.stderr)
if a.dry: print(payload); sys.exit(0)
rq = urllib.request.Request(B, payload.encode(), {"content-type": "application/json", "user-agent": "mcp-scan-stdio/0.1"})
print(urllib.request.urlopen(rq, timeout=60).read().decode())
