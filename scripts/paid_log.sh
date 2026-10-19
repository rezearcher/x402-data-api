#!/bin/bash
# Query Workers Logs for PAID lines (route+payer). Usage: scripts/paid_log.sh [hours=6]
set -a; . <(grep -E '^CF_WORKERS_TOKEN=' ~/.hermes/.env); set +a
ACC=9b5a408f758c052fd9ab99f5d0f32bea
H=${1:-6}; NOW=$(date +%s)000; FROM=$(( $(date +%s) - H*3600 ))000
curl -s -X POST -H "Authorization: Bearer $CF_WORKERS_TOKEN" -H "Content-Type: application/json" \
 "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/observability/telemetry/query" \
 -d "{\"queryId\":\"q1\",\"timeframe\":{\"from\":$FROM,\"to\":$NOW},\"view\":\"events\",\"limit\":100,\"parameters\":{\"filters\":[{\"key\":\"\$metadata.message\",\"operation\":\"includes\",\"type\":\"string\",\"value\":\"PAID\"}]}}" \
 | python3 -c "import sys,json;d=json.load(sys.stdin);[print(e['\$metadata']['message']) for e in d['result']['events']['events']]"
