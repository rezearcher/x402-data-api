#!/usr/bin/env bash
# Append a price tick to the committed provenance archive and, if the baked TS
# snapshot changed, commit + push so CI (deploy.yml, fires on src/**) redeploys
# the Worker with the fresh history. The TIME moat compounds one tick per run.
# Runs ~every 6h via cron (bounded: <=4 deploys/day of archive churn).
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -I scripts/provenance_snapshot.py || { echo "provenance_publish: generator failed"; exit 0; }

if git diff --quiet -- src/provenance_snapshot.ts; then
  echo "provenance_publish: snapshot unchanged, nothing to deploy"
  exit 0
fi

export GH_TOKEN="${GH_TOKEN_CLASSIC:-$(git credential fill <<< $'protocol=https\nhost=github.com\n' 2>/dev/null | sed -n 's/^password=//p')}"
git add src/provenance_snapshot.ts data/provenance_archive.json
git commit -q -m "chore(x402): append provenance tick + refresh baked archive (auto)" || { echo "provenance_publish: nothing committed"; exit 0; }
git push origin main 2>&1 | tail -2
echo "provenance_publish: pushed fresh archive, CI will redeploy"
