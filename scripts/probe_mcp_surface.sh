#!/usr/bin/env bash
# probe_mcp_surface.sh — live /mcp surface probe + glama.json drift gate (t_48f97251).
#
# JSON-RPC POST tools/list round-trip against the live MCP endpoint, extracts the
# returned tool names, and diffs them as a SET against glama.json's toolList.
# The server is the source of truth: DRIFT means glama.json must be reconciled.
#
# Output (stdout, single line):
#   LIVE MCP PROBE: MATCH <count>                      # sets equal
#   LIVE MCP PROBE: DRIFT missing:<a,b> extra:<x,y>    # sets differ
# Exit: 0 = match, 1 = drift, 2 = probe failure (curl/parse error).
#
# Re-runnable from any CWD (self-locating repo root — wrong-CWD failure class of
# t_56ed3a6f). tools/list only: no paid tool invocations, no writes to the Worker.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENDPOINT="${MCP_ENDPOINT:-https://x402-data-api.sigrunner.workers.dev/mcp}"
GLAMA="$ROOT/glama.json"

if [ ! -f "$GLAMA" ]; then
    echo "FATAL: $GLAMA not found" >&2
    exit 2
fi

RESPONSE="$(curl -sS -m 30 -X POST "$ENDPOINT" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')" || {
    echo "FATAL: curl round-trip to $ENDPOINT failed" >&2
    exit 2
}

python3 - "$GLAMA" "$RESPONSE" <<'PY'
import json, sys

glama_path, body = sys.argv[1], sys.argv[2]
manifest = set(json.load(open(glama_path))['toolList'])

# Streamable-HTTP (SSE) responses arrive as `event: message` / `data: {json}` lines;
# plain-JSON servers are handled by the fallback below.
live = set()
for line in body.splitlines():
    if line.startswith('data:'):
        try:
            obj = json.loads(line[5:].strip())
        except json.JSONDecodeError:
            continue
        if 'result' in obj and 'tools' in obj['result']:
            live |= {t.get('name') for t in obj['result']['tools']}
if not live:
    try:
        obj = json.loads(body)
        live = {t.get('name') for t in obj.get('result', {}).get('tools', [])}
    except json.JSONDecodeError:
        pass

if not live:
    print('LIVE MCP PROBE: FAIL no tools parsed', file=sys.stderr)
    sys.exit(2)

missing = sorted(live - manifest)   # live tools absent from glama.json
extra   = sorted(manifest - live)   # glama.json tools absent from live server

if not missing and not extra:
    print(f'LIVE MCP PROBE: MATCH {len(live)}')
    sys.exit(0)
print(f'LIVE MCP PROBE: DRIFT missing:{",".join(missing) or "-"} extra:{",".join(extra) or "-"}')
sys.exit(1)
PY
