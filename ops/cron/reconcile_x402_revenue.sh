#!/usr/bin/env bash
# reconcile_x402_revenue.sh — cron wrapper for the revenue_usd_corrected gap metric.
#
# Runs every 15 minutes (systemd timer x402-revenue-reconcile.timer) so that a Stripe
# dollar landing on the fiat rail is visible to milestone.sh within one window. The
# metric is stale-by-design past 1800 s, so the cadence and the staleness threshold are
# the same number on purpose.
#
# DIVISION OF LABOUR (do not blur this — it is load-bearing)
#   .metrics/reconcile_live_revenue.py is the PRODUCER and owns every persisted file:
#     <metrics>/revenue_usd_corrected
#     <metrics>/.revenue_usd_corrected_timestamp
#     <metrics>/revenue_usd_corrected_status.json
#     <repo>/.metrics/revenue_usd_corrected          (informational mirror)
#     <repo>/.metrics/.revenue_usd_corrected_timestamp
#   Each is written tmp+rename, and the timestamp is written AFTER the value, so a
#   reader never sees a fresh timestamp over a missing/stale value.
#
#   THIS WRAPPER MUST NEVER WRITE THE TIMESTAMP. The producer deliberately does NOT
#   refresh it when the organic input is unreadable, so the metric ages into STALE and
#   milestone.sh reports "producer may be dead" instead of a fabricated flat line. A
#   wrapper that stamps freshness on a zero exit code would convert a dead producer
#   into a green metric forever. That is the single most important line in this file.
#
# EXIT CODES (wrapper — distinct from the producer, which always exits 0)
#   0  ran and healthy, or skipped because the previous run still holds the lock
#   1  producer signalled a degraded/refused persist, or the timestamp is stale after
#      the run (organic rail broken)
#   A non-zero exit marks the oneshot unit failed: visible in `systemctl --user --failed`
#   and the journal, and it trips the Healthchecks dead-man's switch via hc_ping fail.
#
# ALERTING CONTRACT (see docs/cron/x402-revenue-reconcile.md)
#   - Do NOT alert on the producer's exit code; it is always 0 by design.
#   - Alert on: this wrapper's exit code, the timestamp ageing past 1800 s, and
#     organic_status!=ok in the status sidecar. A stale timestamp means "producer
#     broken", never "revenue is zero".
#   - fiat_status=unavailable:* is a WARNING, not an error: the fiat rail degrades open
#     to 0 so that a Stripe/Worker hiccup cannot blind the x402 rail. The cost is that a
#     0 is ambiguous ("no sales yet" vs "could not read"), which is why it is logged.
#
# Manual run:
#   bash ops/cron/reconcile_x402_revenue.sh
#   X402_REPO_ROOT=/path/to/worktree bash ops/cron/reconcile_x402_revenue.sh

set -uo pipefail   # deliberately NOT -e: a failed producer must still be logged and
                   # paged, and this wrapper decides its own exit status.

REPO_ROOT="${X402_REPO_ROOT:-/home/rez/projects/x402-data-api}"
PRODUCER="${REPO_ROOT}/.metrics/reconcile_live_revenue.py"
PYTHON="${X402_PYTHON:-/usr/bin/python3}"

METRICS_DIR="${HOME}/.hermes/data/x402-data-api/metrics"
METRIC_FILE="${METRICS_DIR}/revenue_usd_corrected"
TS_FILE="${METRICS_DIR}/.revenue_usd_corrected_timestamp"
STATUS_FILE="${METRICS_DIR}/revenue_usd_corrected_status.json"

LOG_DIR="${HOME}/.hermes/logs"
LOG_FILE="${LOG_DIR}/x402-revenue-reconcile.log"
LOG_MAX_BYTES=$((5 * 1024 * 1024))

# Lock lives beside the metric, not in /tmp: it must survive tmpfiles cleanup, and it
# must be on the same host as the files it serialises.
LOCK_FILE="${METRICS_DIR}/.reconcile.lock"

STALE_SECONDS=1800
HC_PING="${HOME}/.claude/skills/shared-sensor-store/scripts/hc_ping.sh"
HC_CHECK="x402-revenue-reconcile"

mkdir -p "${METRICS_DIR}" "${LOG_DIR}" 2>/dev/null || true

# ── Logging ────────────────────────────────────────────────────────────────────
log() {  # log <LEVEL> <message...>
    local level="$1"; shift
    printf '[%s] %-5s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "${level}" "$*" >>"${LOG_FILE}"
}

# Keep the log bounded without depending on logrotate being installed.
rotate_log() {
    [ -f "${LOG_FILE}" ] || return 0
    local size
    size=$(stat -c %s "${LOG_FILE}" 2>/dev/null || echo 0)
    if [ "${size}" -gt "${LOG_MAX_BYTES}" ]; then
        mv -f "${LOG_FILE}" "${LOG_FILE}.1" 2>/dev/null || true
        log INFO "rotated log (exceeded ${LOG_MAX_BYTES} bytes)"
    fi
}

hc() {  # hc <ok|fail> — degrade-open: monitoring must never break the job
    [ -x "${HC_PING}" ] || return 0
    "${HC_PING}" "${HC_CHECK}" "$1" >/dev/null 2>&1 || true
}

metric_age() {  # echo seconds since the timestamp was written, or -1 if unknown
    [ -f "${TS_FILE}" ] || { echo -1; return; }
    local ts
    ts=$(tr -dc '0-9' <"${TS_FILE}" 2>/dev/null)
    [ -n "${ts}" ] || { echo -1; return; }
    echo $(( $(date +%s) - ts ))
}

rotate_log

# ── Preflight ──────────────────────────────────────────────────────────────────
if [ ! -f "${PRODUCER}" ]; then
    log ERROR "producer missing: ${PRODUCER}"
    hc fail
    exit 1
fi
if [ ! -x "${PYTHON}" ] && ! command -v "${PYTHON}" >/dev/null 2>&1; then
    log ERROR "interpreter not found: ${PYTHON}"
    hc fail
    exit 1
fi

# ── Single-flight ──────────────────────────────────────────────────────────────
# An in-flight run holds an HTTPS connection to the Worker. Overlapping ticks would
# interleave the metric/timestamp pair. Skip (not fail) on contention: a skip is the
# correct behaviour, and a permanently-held lock shows up as a stale timestamp.
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
    age=$(metric_age)
    log WARN "skipped: previous run still holds ${LOCK_FILE} (metric age ${age}s)"
    exit 0
fi

# ── Run the producer ───────────────────────────────────────────────────────────
log INFO "start: ${PYTHON} ${PRODUCER}"
out=$("${PYTHON}" "${PRODUCER}" 2>&1)
rc=$?
[ -n "${out}" ] && printf '%s\n' "${out}" | while IFS= read -r line; do log INFO "| ${line}"; done

if [ "${rc}" -ne 0 ]; then
    # Should be unreachable (the producer swallows everything into exit 0), so this
    # branch means it was killed, the interpreter died, or the file is corrupt.
    log ERROR "producer exited ${rc} (unexpected — the producer is designed to always exit 0)"
    hc fail
    exit 1
fi

# ── Post-run health assessment ─────────────────────────────────────────────────
get_field() {  # get_field <name> — read one key=value line from the producer's output
    printf '%s\n' "${out}" | sed -n "s/^$1=//p" | head -1
}

organic_status="$(get_field organic_status)"
fiat_status="$(get_field fiat_status)"
persisted="$(get_field persisted)"
blocked="$(get_field persist_blocked_because)"
value="$(get_field revenue_usd_corrected)"
age="$(metric_age)"

failed=0

if [ "${organic_status}" != "ok" ]; then
    # The producer preserved the last good value and did not refresh the timestamp.
    log ERROR "organic rail unusable (organic_status=${organic_status}) — metric NOT refreshed; milestone.sh will read STALE${blocked:+ (blocked: ${blocked})}"
    failed=1
fi

if [ "${persisted}" != "true" ] && [ "${organic_status}" = "ok" ]; then
    log ERROR "producer did not persist (persisted=${persisted}${blocked:+, blocked: ${blocked}}) despite an ok organic rail"
    failed=1
fi

if [ "${age}" -lt 0 ]; then
    log ERROR "timestamp file unreadable or absent: ${TS_FILE} — milestone.sh will treat the value as current forever"
    failed=1
elif [ "${age}" -gt "${STALE_SECONDS}" ]; then
    log ERROR "timestamp stale after run: age=${age}s > ${STALE_SECONDS}s"
    failed=1
fi

case "${fiat_status}" in
    unavailable:*)
        log WARN "fiat rail unavailable (${fiat_status}) — degraded to 0; a 0 here is ambiguous, check ${STATUS_FILE}"
        ;;
esac

if [ "${failed}" -ne 0 ]; then
    log ERROR "FAILED (value=${value:-unknown} organic_status=${organic_status:-unknown} fiat_status=${fiat_status:-unknown} age=${age}s)"
    hc fail
    exit 1
fi

log INFO "ok: revenue_usd_corrected=${value} age=${age}s persisted=true organic_status=ok fiat_status=${fiat_status}"
hc ok
exit 0
