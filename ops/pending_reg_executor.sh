#!/usr/bin/env bash
# pending_reg_executor.sh — runs the vault-gated money-loop registrations (HOL, x402scan)
# ONCE the 1Password account cap has reset. Anticipates (checks op), never hammers.
set -uo pipefail
LOG="$HOME/.hermes/logs/pending_reg.log"; mkdir -p "$(dirname "$LOG")"
say(){ echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }
[ -f "$HOME/.config/greyridge/op.env" ] && { set -a; . "$HOME/.config/greyridge/op.env" 2>/dev/null; set +a; }

# op ready?
REMAIN=$(op service-account ratelimit --format json 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((r.get('limit',0)-r.get('used',0) for r in (d if isinstance(d,list) else [d]) if r.get('type')=='account'),0))" 2>/dev/null || echo 0)
if [ "${REMAIN:-0}" -le 5 ]; then say "op still capped (remaining=$REMAIN) — will retry next tick."; exit 0; fi
say "op available (remaining=$REMAIN) — executing pending registrations."

# --- HOL: flow known (ledger EVM path, free ERC-8004 tier) — TODO wire once verified ---
say "HOL: TODO — run hol_register.mjs with ETH_PK from vault (pending verification)."
# --- x402scan: flow being researched by agent a0f816 — TODO fill from its report ---
say "x402scan: TODO — apply researched flow (Bazaar auto-index vs explicit register)."

say "executor ran — see TODOs; this scaffold is replaced once both flows are verified."
