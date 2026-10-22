#!/usr/bin/env bash
# stripe_rail_setup.sh — wire the fiat rail for the Pro ($9.99/mo -> 100 credits) product.
#
# Rez's only atom: a Stripe secret key (sk_live_… / sk_test_… or a restricted rk_… key).
# Everything below is automated and idempotent:
#   1) create/reuse the $9.99/mo recurring Price           -> STRIPE_PRICE_ID
#   2) (re)create the webhook endpoint at /stripe/webhook  -> STRIPE_WEBHOOK_SECRET
#   3) push all three as Cloudflare Worker secrets (live immediately, no redeploy)
#   4) mirror the three into 1Password (Division) for durability (best-effort)
#   5) verify end-to-end: hit the live endpoint, expect a real checkout URL
#
# Usage:
#   scripts/stripe_rail_setup.sh sk_live_xxx          # key as arg
#   STRIPE_API_KEY=sk_live_xxx scripts/stripe_rail_setup.sh   # or via env
#   scripts/stripe_rail_setup.sh                       # or reads op://Division/STRIPE_API_KEY/credential
#
# Safe to re-run. Test keys prove the whole loop with zero money at risk; live keys arm it.
set -euo pipefail

WORKER_URL="https://api.greyridgesignals.ai"
WEBHOOK_URL="${WORKER_URL}/stripe/webhook"
PRICE_LOOKUP_KEY="greyridge_pro_monthly"
API="https://api.stripe.com/v1"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. resolve the Stripe key (arg > env > 1Password) ---
KEY="${1:-${STRIPE_API_KEY:-}}"
if [ -z "$KEY" ]; then
  source ~/.config/greyridge/op.env 2>/dev/null || true
  KEY="$(op read op://Division/STRIPE_API_KEY/credential 2>/dev/null || true)"
fi
[ -n "$KEY" ] || die "no Stripe key (pass as arg, set STRIPE_API_KEY, or store op://Division/STRIPE_API_KEY/credential)"
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"   # strip any stray newline/space from paste
case "$KEY" in
  sk_live_*|rk_live_*) MODE="LIVE" ;;
  sk_test_*|rk_test_*) MODE="TEST" ;;
  *) die "unrecognized key prefix — expected sk_live_/sk_test_/rk_live_/rk_test_" ;;
esac
say "Stripe key loaded — mode: $MODE"

sapi() { # sapi METHOD /path [curl args...]
  local m="$1" p="$2"; shift 2
  curl -fsS -X "$m" "${API}${p}" -u "${KEY}:" "$@"
}

# --- validate the key actually works before touching anything ---
# Validate against a scope we actually granted (Prices: read via write). A restricted
# key does NOT get /v1/account unless the "Account" scope is granted, which we don't need.
sapi GET "/prices?limit=1" >/dev/null 2>&1 \
  || die "key rejected by Stripe — invalid/revoked, OR missing 'Prices' (Billing) Write scope. Re-check the 6 scopes."
# Best-effort account label (won't fail if the Account scope isn't granted)
ACCT="$(sapi GET /account 2>/dev/null || true)"
[ -n "$ACCT" ] && echo "  account: $(echo "$ACCT" | python3 -c 'import sys,json;a=json.load(sys.stdin);print(a.get("id"),"|",a.get("business_profile",{}).get("name") or a.get("email") or "(no name)")' 2>/dev/null)" || echo "  key valid (account label not exposed to this restricted key — fine)"

# --- 1. Price: reuse by lookup_key, else create a $9.99/mo recurring price ---
say 'Price (9.99/mo recurring)'
PRICE_ID="$(sapi GET "/prices?lookup_keys[]=${PRICE_LOOKUP_KEY}&limit=1&active=true" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d[0]["id"] if d else "")')"
if [ -z "$PRICE_ID" ]; then
  PRICE_ID="$(sapi POST /prices \
    -d unit_amount=999 -d currency=usd \
    -d 'recurring[interval]=month' \
    -d "lookup_key=${PRICE_LOOKUP_KEY}" \
    -d 'product_data[name]=Grey Ridge Signals — Pro (100 API credits/mo)' \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
  echo "  created $PRICE_ID"
else
  echo "  reusing $PRICE_ID"
fi

# --- 2. Webhook: delete any stale endpoint for our URL, create fresh to capture the secret ---
say "Webhook endpoint -> ${WEBHOOK_URL}"
for id in $(sapi GET "/webhook_endpoints?limit=100" \
  | python3 -c "import sys,json;print(' '.join(e['id'] for e in json.load(sys.stdin)['data'] if e['url']=='${WEBHOOK_URL}'))"); do
  sapi DELETE "/webhook_endpoints/${id}" >/dev/null && echo "  removed stale $id"
done
WH_JSON="$(sapi POST /webhook_endpoints \
  -d "url=${WEBHOOK_URL}" \
  -d 'enabled_events[]=checkout.session.completed')"
WHSEC="$(echo "$WH_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["secret"])')"
WH_ID="$(echo "$WH_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
[ -n "$WHSEC" ] || die "webhook created but no signing secret returned"
echo "  created $WH_ID (secret captured)"

# --- 3. Cloudflare Worker secrets (apply to the deployed worker immediately) ---
say "Setting Cloudflare Worker secrets"
source ~/.config/greyridge/op.env 2>/dev/null || true
export CLOUDFLARE_API_TOKEN="$(op read op://Division/CF_WORKERS_TOKEN/credential 2>/dev/null)"
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "CF_WORKERS_TOKEN not readable from 1Password"
cd "$(dirname "$0")/.."
printf '%s' "$KEY"      | npx --no-install wrangler secret put STRIPE_API_KEY       >/dev/null && echo "  STRIPE_API_KEY set"
printf '%s' "$PRICE_ID" | npx --no-install wrangler secret put STRIPE_PRICE_ID      >/dev/null && echo "  STRIPE_PRICE_ID set"
printf '%s' "$WHSEC"    | npx --no-install wrangler secret put STRIPE_WEBHOOK_SECRET >/dev/null && echo "  STRIPE_WEBHOOK_SECRET set"

# --- 4. Mirror into 1Password for durability (best-effort, non-fatal) ---
say "Mirroring secrets into 1Password (Division)"
mirror() { op item edit "$1" "credential=$2" --vault Division >/dev/null 2>&1 \
  || op item create --category "API Credential" --title "$1" --vault Division "credential=$2" >/dev/null 2>&1 \
  && echo "  $1 mirrored" || echo "  $1 mirror skipped (op rate-limit?)"; }
mirror STRIPE_API_KEY "$KEY"
mirror STRIPE_PRICE_ID "$PRICE_ID"
mirror STRIPE_WEBHOOK_SECRET "$WHSEC"

# --- 5. Verify end-to-end against the live worker ---
say "Verifying live checkout path"
sleep 3  # let the secret propagate
RESP="$(curl -fsS -X POST "${WORKER_URL}/stripe/create-checkout-session" 2>&1 || true)"
echo "  $RESP"
if echo "$RESP" | grep -q 'checkout.stripe.com'; then
  printf '\n\033[32mRAIL ARMED (%s). The Subscribe button now opens a real Stripe checkout.\033[0m\n' "$MODE"
  [ "$MODE" = "TEST" ] && echo "This is a TEST key — re-run with a live key (sk_live_…) to take real money."
else
  die "checkout session did not return a Stripe URL — check 'wrangler tail' for stripe_session_error"
fi
