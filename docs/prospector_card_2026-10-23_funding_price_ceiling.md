WHAT: Ratchet the price of GET /crypto/funding from $0.004 to $0.01 (2.5x) as a bounded, reversible price-ceiling probe, with a pre-registered revert tripwire. Touches only the price constants for that one route in src/index.ts (mk() manifest units, paid() entry, makeRoutes() gate price at ~line 2509, advertised-price strings) and the price-consistency sensor expectations. Nothing else.

WHY: gap.json milestone = first paid dollar, revenue_usd_corrected 0.005 vs threshold 1.0. The on-chain ledger (~/.hermes/data/x402-revenue/scan_state.json, 478 non-whale transfers, 25 payers) shows revenue is NOT spread across buyers: 3 wallets are 94 percent of dollars, all burst bots. 0x2533022c paid 117 calls at exactly $0.004 (/crypto/funding) inside a ~30k-block window, ZERO attrition after the 4x bump (t_23029eff, $0.001 to $0.004). 0x5738210c paid 200 at $0.001 in ~500 blocks. 0xc4852c26 paid at mixed prices incl. 15 calls at $0.02. These bots pay the advertised price without negotiating. Status quo: one more 117-call burst earns 0.47 USD, a 2x short of the 1.0 threshold. At $0.01 the SAME burst earns 1.17 USD and crosses the gap alone; at $0.004 it takes about 250 calls. Expected gain vs status quo: 2.5x revenue per burst (0.47 to 1.17). Baseline comparison (D11): no ML, pure price constant; the baseline is the live $0.004 and the measured 0 percent attrition across 117 calls.

CAVEAT (honest): burst wallets may be probe or farming bots; milestone text says real traced sale. This card does not claim buyer intent, it raises revenue per paying event on the only route with proven price-insensitive repeat payment, and logs payer cohort so the next critic can classify it.

FILES: src/index.ts (funding price constants, ~lines 179, 806, 1278, 1361, 1551, 1883, 1915, 2509); scripts price-consistency sensor expectations
BUDGET: --max-runtime 1800
TRIPWIRE: if 14 days after deploy there is zero payment on /crypto/funding AND the prior 14 days had at least 1, revert to 0.004 (single-line revert).

ACCEPTANCE: CHECK: bash -c '[ "$(curl -s -o /dev/null -w "%{http_code}" https://x402-data-api.sigrunner.workers.dev/crypto/funding)" = "402" ] && [ "$(curl -sD - -o /dev/null https://x402-data-api.sigrunner.workers.dev/crypto/funding | grep -i "^payment-required:" | cut -d" " -f2 | tr -d "\r" | base64 -d | python3 -c "import sys,json;print(json.load(sys.stdin)[\"accepts\"][0][\"amount\"])")" = "10000" ] && [ "$(curl -s -o /dev/null -w "%{http_code}" https://x402-data-api.sigrunner.workers.dev/crypto/funding/preview)" = "200" ] && [ "$(grep -c "\"/crypto/funding\", \"GET\", \"0.01\"" src/index.ts)" = "1" ]'
METRIC: revenue_usd_corrected >= 1.0 (gap.json target_metric; read via milestone.sh gap x402-data-api)

GUARDRAILS:
  - runs in an isolated worktree; never the live tree
  - additive-only for money code: touches only the funding price constants and advertised-price strings; no changes to Stripe, wallet key handling, revenue_ledger.py, settlement or reconciliation
  - never push to repos that are not ours
  - deploy only after typecheck passes; irreversible or capital actions stay gated to the human
TYPE: build
PRIORITY-RATIONALE: directly sized against the 1.0 threshold gap; cheapest reversible lever with measured evidence
