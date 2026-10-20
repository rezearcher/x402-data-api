#!/usr/bin/env bash
# Usage: mcp_badge.sh https://host/mcp > badge.json
# Emits a shields.io "endpoint" JSON (https://shields.io/endpoint) from the free /scan/mcp/preview verdict,
# so a directory can render  img.shields.io/endpoint?url=<hosted badge.json>  per listing.
B=${GREYRIDGE_HOST:-https://x402-data-api.sigrunner.workers.dev}
r=$(curl -s -m 30 -G "$B/scan/mcp/preview" --data-urlencode "url=$1")
python3 -c '
import sys,json
try: j=json.loads(sys.argv[1])
except Exception: j={}
v=j.get("verdict")
if not v: out={"schemaVersion":1,"label":"mcp-scan","message":"not scanned","color":"lightgrey"}
else:
    c={"clear":"brightgreen","review":"yellow","block":"red"}.get(v,"lightgrey")
    out={"schemaVersion":1,"label":"mcp-scan","message":"%s (%s tools, %s issues)"%(v,j.get("tools_scanned"),j.get("issue_count")),"color":c}
print(json.dumps(out))' "$r"
