#!/usr/bin/env bash
# Keep GET /status fresh: regenerate the measured snapshot and, if it changed,
# commit + push so CI (deploy.yml) redeploys the worker with current numbers.
# Runs once daily (bounded to <=1 deploy/day of status churn). Measured-only.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -I scripts/status_report.py >/dev/null 2>&1

# Only act if the bundled snapshot actually changed.
if git diff --quiet -- src/status_snapshot.ts; then
  echo "status_publish: snapshot unchanged, nothing to deploy"
  exit 0
fi

export GH_TOKEN="${GH_TOKEN_CLASSIC:-$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | sed -n 's/^password=//p')}"
git add src/status_snapshot.ts docs/STATUS.md
git commit -q -m "chore(x402): refresh measured /status snapshot (auto)" || { echo "status_publish: nothing committed"; exit 0; }
git push origin main 2>&1 | tail -2
echo "status_publish: pushed fresh snapshot, CI will redeploy"
