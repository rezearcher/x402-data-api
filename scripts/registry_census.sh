#!/usr/bin/env bash
# Usage: registry_census.sh remotes.json out.jsonl  -- live-preview scan of each streamable-http remote (static tools/list audit only)
B=${GREYRIDGE_HOST:-https://x402-data-api.sigrunner.workers.dev}
export B
python3 -c 'import json,sys;[print(r[2]) for r in json.load(open(sys.argv[1])) if r[1]=="streamable-http"]' "$1" | sort -u | \
 xargs -P6 -I{} bash -c 'o=$(curl -s -m 25 -G "$B/scan/mcp/preview" --data-urlencode "url={}"); echo "{\"url\":\"{}\",\"r\":${o:-null}}" ' > "$2" 2>/dev/null
