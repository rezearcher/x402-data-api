#!/usr/bin/env bash
# nohumans_resync.sh — cron wrapper for scripts/nohumans_resync.py.
#
# Keeps our nohumans.directory listings' semantic embeddings fresh (re-PATCH) and
# measures our /v1/discover rank for the real buyer terms, so a listing can never
# silently drift behind our live catalog again (the "listed != discoverable" bug:
# an indexed listing is embedded ONCE and never re-pulls our updated 402 metadata
# without an edit). Writes ~/.hermes/data/nohumans/discover_rank.json.
#
# Degrades open: a listing with no reachable edit token still gets its read-only
# discover measurement; the script never exits non-zero (sensor, not a gate).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="${HOME}/.hermes/logs/x402-nohumans-resync.log"
mkdir -p "$(dirname "$LOG")"

{
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) nohumans resync ==="
    cd "$REPO" || exit 0
    python3 -I scripts/nohumans_resync.py 2>&1
    echo
} >>"$LOG" 2>&1

# Mirror the one-line coverage summary to stdout for the journal.
tail -n 20 "$LOG" | grep -E "discover coverage:" | tail -n1 || true
exit 0
