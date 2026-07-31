#!/usr/bin/env bash
# Submit x402-data-api to x402-list.com registry
# OpenAPI: https://x402-list.com/openapi.json
# Usage: ./scripts/submit_x402_list.sh [email] [api_domain] [website_url]
# Examples:
#   ./scripts/submit_x402_list.sh                                    # defaults
#   ./scripts/submit_x402_list.sh me@example.com api.example.com     # custom API domain
#   ./scripts/submit_x402_list.sh me@example.com api.foo.com https://foo.com
#
# Required fields per ServiceSubmissionRequest (oneOf):
#   url, email, service_name, description, website_url, category, endpoints

set -euo pipefail

EMAIL="${1:-matthewjaybowman@gmail.com}"
DOMAIN="${2:-x402-data-api.sigrunner.workers.dev}"
WEBSITE="${3:-https://sigrunner.com}"

# Reject dev-tunnel / free-hosting domains for BOTH url (API) and website_url
if [[ "$DOMAIN" == *".workers.dev"* ]] || [[ "$DOMAIN" == *".pages.dev"* ]] || [[ "$DOMAIN" == *".trycloudflare.com"* ]]; then
  echo "ERROR: x402-list.com rejects free-hosting/dev-tunnel domains for API domain."
  echo "Pass a real domain as second argument."
  echo "  $0 <email> <api_domain> <website_url>"
  exit 1
fi

if [[ "$WEBSITE" == *".workers.dev"* ]] || [[ "$WEBSITE" == *".pages.dev"* ]] || [[ "$WEBSITE" == *".trycloudflare.com"* ]]; then
  echo "ERROR: x402-list.com rejects free-hosting/dev-tunnel domains for website_url."
  echo "Pass a real domain as third argument."
  echo "  $0 <email> <api_domain> <website_url>"
  exit 1
fi

API_URL="https://x402-list.com/api/v1/submit"

PAYLOAD=$(cat <<EOF
{
  "url": "https://${DOMAIN}",
  "email": "${EMAIL}",
  "service_name": "Grey Ridge Signals — Base-native x402 Data & Security APIs",
  "description": "Agent-native prediction-market and crypto-finance data service. Live Polymarket markets, Hyperliquid/OKX/dYdX funding rates, DeFi lending yields, Base blockchain RPC, MCP security audits (tool-poisoning, prompt-injection). Pay-per-call via x402 USDC on Base mainnet via xpay.sh facilitator. No API keys, no signup.",
  "website_url": "${WEBSITE}",
  "category": "Data",
  "endpoints": [
    "/chain/block-number",
    "/chain/gas-price",
    "/chain/balance",
    "/chain/token-balance",
    "/chain/tx",
    "/chain/receipt",
    "/chain/code",
    "/chain/wallet",
    "/chain/token-security",
    "/crypto/prices",
    "/crypto/funding",
    "/defi/yields",
    "/pm/markets",
    "/scan/mcp",
    "/enrich/tech-risk",
    "/enrich/domain"
  ],
  "notes": "x402 v2 challenges with content-type and accept negotiation. Settlement via xpay.sh facilitator on Base eip155:8453. Wallets: 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10. Listed in CDP Bazaar. PRs: GreyRidge/sigrunner#38, GreyRidge/sigrunner#887."
}
EOF
)

echo "Submitting to x402-list.com..."
echo "  API domain:  ${DOMAIN}"
echo "  Website:     ${WEBSITE}"
echo "  Email:       ${EMAIL}"
echo

RESPONSE=$(curl -s -w '\nHTTP_STATUS:%{http_code}' \
  -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_STATUS=$(echo "$RESPONSE" | tail -1 | cut -d: -f2)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: ${HTTP_STATUS}"
echo "Response:"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [[ "$HTTP_STATUS" == "200" ]] || [[ "$HTTP_STATUS" == "201" ]]; then
  LISTING_ID=$(echo "$BODY" | jq -r '.listing_id // empty' 2>/dev/null)
  echo
  echo "✓ Successfully submitted to x402-list.com"
  if [[ -n "$LISTING_ID" ]]; then
    echo "  Listing ID: ${LISTING_ID}"
    echo "  Check status: curl https://x402-list.com/api/v1/listings/${LISTING_ID}"
  fi
  exit 0
else
  echo
  echo "✗ Submission failed"
  exit 1
fi
