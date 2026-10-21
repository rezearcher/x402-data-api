#!/usr/bin/env bash
# Grey Ridge x402 — one-step MCP tool-poisoning preview for an MCP server you run.
#
# Pulls your server's tools/list over the MCP Streamable-HTTP transport (works
# through auth), extracts the advertised tool metadata, and POSTs *only that*
# (names + descriptions + schemas — never a tool call, never your data) to the
# free Grey Ridge preview. You get: tools_scanned, severity breakdown, risk_score
# and a go/review verdict. The paid itemized scan ($0.05 via x402 GET /scan/mcp,
# or $0.005 as the scan_mcp_server MCP tool) adds WHICH tool, the evidence and
# remediation.
#
# Nothing of yours leaves your side except the tool descriptions your server
# already advertises to any client. Static analysis only; it does not invoke tools.
#
# Usage:
#   BRIDGE=https://bridge.example.com/mcp ./mcp-scan-preview.sh
#   BRIDGE=https://bridge.example.com/mcp TOKEN="Bearer eyJ..." ./mcp-scan-preview.sh
#
# Deps: curl + python3 (both already on any box that runs an MCP server).

set -euo pipefail

BRIDGE="${BRIDGE:?set BRIDGE=https://your-mcp-host/mcp}"
PREVIEW="${PREVIEW:-https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview}"
AUTH_ARGS=()
[ -n "${TOKEN:-}" ] && AUTH_ARGS=(-H "authorization: ${TOKEN}")

echo ">> tools/list from ${BRIDGE}" >&2
RAW="$(curl -s -X POST "${BRIDGE}" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  "${AUTH_ARGS[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')"

# MCP Streamable-HTTP may answer as SSE (event:/data: frames) or plain JSON.
TOOLS_JSON="$(printf '%s' "$RAW" | python3 -c '
import sys, json
raw = sys.stdin.read()
obj = None
for line in raw.splitlines():
    line = line.strip()
    if line.startswith("data:"):
        line = line[5:].strip()
    if not line:
        continue
    try:
        o = json.loads(line)
    except Exception:
        continue
    if isinstance(o, dict) and "result" in o:
        obj = o
        break
if obj is None:
    try:
        obj = json.loads(raw)
    except Exception as e:
        sys.exit("could not parse tools/list response: %s" % e)
tools = (obj.get("result") or {}).get("tools")
if not tools:
    sys.exit("no tools in tools/list response (auth/transport issue?)")
print(json.dumps({"tools": tools}))
')"

echo ">> scanning $(printf '%s' "$TOOLS_JSON" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["tools"]))') tool(s) via free preview" >&2
curl -s -X POST "${PREVIEW}" -H 'content-type: application/json' -d "${TOOLS_JSON}"
echo
