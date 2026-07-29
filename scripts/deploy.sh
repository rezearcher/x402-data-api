#!/usr/bin/env bash
# scripts/deploy.sh — Deploy x402-data-api using CF_WORKERS_TOKEN
#
# Uses CF_WORKERS_TOKEN (not CF_API_TOKEN) because the former has
# Workers:Write scope. This is the correct credential.
#
# Usage:
#   CLOUDFLARE_API_TOKEN="$(grep '^CF_WORKERS_TOKEN=' ~/.hermes/.env | cut -d= -f2-)" bash scripts/deploy.sh
#
# Or set CF_WORKERS_TOKEN in the environment and run:
#   bash scripts/deploy.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# --- Resolve token -----------------------------------------------------------
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  if [ -n "${CF_WORKERS_TOKEN:-}" ]; then
    CLOUDFLARE_API_TOKEN="$CF_WORKERS_TOKEN"
  elif [ -f ~/.hermes/.env ]; then
    CLOUDFLARE_API_TOKEN="$(grep '^CF_WORKERS_TOKEN=' ~/.hermes/.env | cut -d= -f2-)"
  fi
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "FATAL: No CF_WORKERS_TOKEN found. Set CLOUDFLARE_API_TOKEN or CF_WORKERS_TOKEN." >&2
  exit 1
fi

export CLOUDFLARE_API_TOKEN

echo "=== Deploying x402-data-api ==="
echo "Token prefix: ${CLOUDFLARE_API_TOKEN:0:8}..."

npx wrangler deploy 2>&1

echo "=== Deploy complete ==="
