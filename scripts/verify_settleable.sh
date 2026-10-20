#!/usr/bin/env bash
# verify_settleable.sh — prove our live routes are SETTLEABLE through the CDP
# facilitator, without spending a cent and without self-dealing.
#
# How it works (discriminating test): for each route we pull the live 402
# `accepts[0]` (the exact paymentRequirements a buyer uses), wrap it in a
# structurally-valid x402-v2 ExactEvm PaymentPayload carrying a DELIBERATELY
# INVALID signature (R=0), and POST it to /internal/cdp-settle-raw. That proxy
# only calls settle if verify==200, so an invalid signature can NEVER move money.
#   - verify fails with invalid_exact_evm_payload_signature  => requirements
#     ACCEPTED by the facilitator; a real signed payment settles. (PASS)
#   - verify fails citing network/scheme/version/asset/amount => a REQUIREMENTS
#     blocker: the facilitator can't accept this route => $0 is a supply bug. (FAIL)
#
# Proven 2026-10-20am: all tiers PASS — $0 revenue is a demand problem, not a
# settlement/format/network/version problem. Re-run after any route/price change.
#
# Requires: 1Password `op` (Division vault) for RAPIDAPI_PROXY_SECRET.
# Usage: scripts/verify_settleable.sh [route ...]   (defaults to a price-tier sample)
set -euo pipefail
B="https://x402-data-api.sigrunner.workers.dev"
SEC="$(op item get aglhll7y6lqlpskq2amodaoi5y --vault Division --fields credential --reveal 2>/dev/null)"
if [ -z "${SEC:-}" ]; then echo "ERROR: could not read RAPIDAPI_PROXY_SECRET from 1Password"; exit 1; fi

# One route per price tier by default: $0.001, $0.004, $0.008, $0.01, $0.05.
ROUTES=("$@")
if [ ${#ROUTES[@]} -eq 0 ]; then
  ROUTES=("/defi/yields?chain=base" "/crypto/funding?symbol=BTC" "/gate/swap?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&side=buy&notional_usd=100" "/chain/gas-price" "/scan/mcp?url=https://example.com/mcp")
fi

pass=0; fail=0
for r in "${ROUTES[@]}"; do
  req=$(curl -s "$B$r" | python3 -I -c "import json,sys
try:
    d=json.load(sys.stdin); print(json.dumps(d['accepts'][0]))
except Exception as e: print('')" )
  if [ -z "$req" ]; then echo "SKIP  $r  (no 402 accepts[0] — not a paid route?)"; continue; fi
  body=$(python3 -I - "$req" <<'PY'
import json,sys
req=json.loads(sys.argv[1])
pp={"x402Version":2,"accepted":req,"payload":{"signature":"0x"+"00"*65,
  "authorization":{"from":"0xC4852c26498d3187dEc2ce1b19e840710e302d1e","to":req.get("payTo"),
  "value":req.get("amount"),"validAfter":"0","validBefore":"9999999999","nonce":"0x"+"11"*32}}}
print(json.dumps({"paymentPayload":pp,"paymentRequirements":req}))
PY
)
  resp=$(curl -s -X POST "$B/internal/cdp-settle-raw" -H "X-RapidAPI-Proxy-Secret: $SEC" -H "content-type: application/json" --data "$body")
  reason=$(printf '%s' "$resp" | python3 -I -c "import json,sys
try:
    d=json.load(sys.stdin); v=d.get('verify',{});
    import json as j; b=j.loads(v.get('body','{}'))
    print(b.get('invalidReason') or b.get('errorType') or ('status_'+str(v.get('status'))))
except Exception as e: print('parse_err')")
  if [ "$reason" = "invalid_exact_evm_payload_signature" ]; then
    echo "PASS  $r  (requirements accepted; reached signature check)"; pass=$((pass+1))
  else
    echo "FAIL  $r  (verify rejected on: $reason)  => REQUIREMENTS BLOCKER"; fail=$((fail+1))
    printf '      %s\n' "$resp" | head -1
  fi
done
echo "---- settleable: $pass PASS / $fail FAIL ----"
[ "$fail" -eq 0 ]
