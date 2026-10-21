#!/usr/bin/env bash
# demand_signal.sh — read REAL inbound demand on the live x402 API.
#
# Prints per-path hit counts (all non-paid probes + free-preview hits) and the
# paid feed from the TrafficLog Durable Object. This is the ground-truth signal
# for which routes buyers actually touch — use it instead of guessing demand.
#
# Requires: 1Password service-account `op` (Division vault) for the authed secret.
# Usage: scripts/demand_signal.sh [window_hours]   (default 168 = 7d)
#
# NOTE: the DO runs on the CF free tier. If it returns
#   "Exceeded allowed rows written in Durable Objects free tier"
# the daily write budget is spent; it resets at UTC midnight. The per-wake prune
# amplification was first cut 2026-10-20 (ad28e19) but the 5% sample + LIMIT-200
# prune still blew the 100k/day cap on 2026-10-21; now 1% sample + LIMIT-100 prune
# (commit 5443f51) projects ~16k rows_written/day. nonpaid_scale is read live from
# the API, so this reader stays correct across sample-rate changes.
set -euo pipefail
B="https://x402-data-api.sigrunner.workers.dev"
HOURS="${1:-168}"
SEC="$(op item get byllgy4p3b27hrscwcdxofe6e4 --vault Division --fields credential --reveal 2>/dev/null)"
if [ -z "$SEC" ]; then echo "ERROR: could not read TRAFFIC_STATS_SECRET from 1Password"; exit 1; fi

echo "=== non-paid hits, last ${HOURS}h ==="
curl -s "$B/internal/traffic-stats?window_hours=${HOURS}&secret=${SEC}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if not d.get('ok'):
    print('read failed:', d.get('detail') or d); sys.exit(0)
st=d.get('stats',[])
scale=d.get('nonpaid_scale',1)
print(f\"distinct paths: {len(st)} | sampled hits: {sum(x['count'] for x in st)} | nonpaid_scale x{scale} (non-paid sampled)\")
print(f\"  {'sampled':>7}  {'~true':>8}  path\")
for x in st[:50]: print(f\"  {x['count']:>7}  {x['count']*scale:>8}  {x['path']}\")
"
echo "=== paid feed, last ${HOURS}h ==="
curl -s "$B/internal/traffic-stats?window_hours=${HOURS}&secret=${SEC}&paid=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if not d.get('ok'):
    print('read failed:', d.get('detail') or d); sys.exit(0)
p=d.get('paid',[])
print('paid rows:', len(p))
for r in p[:30]: print('  ', r)
"
