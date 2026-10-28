#!/usr/bin/env bash
# install.sh — install the x402 revenue_usd_corrected refresh timer.
#
# Idempotent. Symlinks the units out of the repo so the tracked copies stay the single
# source of truth (edit the file in ops/cron/systemd/, re-run this, done).
#
#   bash ops/cron/install.sh          # install + enable + smoke test
#   bash ops/cron/install.sh --uninstall
set -euo pipefail

UNIT_DIR="${HOME}/.config/systemd/user"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${HERE}/systemd"
UNITS=(x402-revenue-reconcile.service x402-revenue-reconcile.timer)

if [ "${1:-}" = "--uninstall" ]; then
    systemctl --user disable --now x402-revenue-reconcile.timer 2>/dev/null || true
    rm -f "${UNIT_DIR}/x402-revenue-reconcile.timer" "${UNIT_DIR}/x402-revenue-reconcile.service"
    systemctl --user daemon-reload
    echo "uninstalled. (The producer's output files under ~/.hermes/data are left in place.)"
    exit 0
fi

command -v systemctl >/dev/null || { echo "systemctl not found" >&2; exit 1; }
systemctl --user show-environment >/dev/null 2>&1 || {
    echo "no systemd user manager for this session; cannot install" >&2; exit 1; }

mkdir -p "${UNIT_DIR}"
for u in "${UNITS[@]}"; do
    ln -sfn "${SRC_DIR}/${u}" "${UNIT_DIR}/${u}"
    echo "linked ${UNIT_DIR}/${u} -> ${SRC_DIR}/${u}"
done

chmod +x "${HERE}/reconcile_x402_revenue.sh"

# daemon-reload is not optional. Editing a unit without it leaves the *previously loaded*
# definition running; that is how the first install here kept aborting with status=216/GROUP
# while the on-disk file looked correct.
systemctl --user daemon-reload

systemctl --user enable x402-revenue-reconcile.timer
systemctl --user restart x402-revenue-reconcile.timer

echo
echo "--- smoke test (synchronous run) ---"
systemctl --user start x402-revenue-reconcile.service || true
systemctl --user status x402-revenue-reconcile.service --no-pager --lines=15 || true

echo
echo "--- timer ---"
systemctl --user list-timers x402-revenue-reconcile.timer --no-pager || true

echo
echo "--- metric freshness ---"
TS="${HOME}/.hermes/data/x402-data-api/metrics/.revenue_usd_corrected_timestamp"
if [ -f "${TS}" ]; then
    AGE=$(( $(date +%s) - $(cat "${TS}") ))
    echo "value=$(cat "${HOME}/.hermes/data/x402-data-api/metrics/revenue_usd_corrected" 2>/dev/null | tr -d '\n') age=${AGE}s (stale at 1800s)"
else
    echo "NO TIMESTAMP — the producer refused to persist; check the log:" >&2
    echo "  ${HOME}/.hermes/logs/x402-revenue-reconcile.log" >&2
    exit 1
fi
