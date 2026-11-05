WHAT: SUPERSEDES/KILLS the premise of t_aaafb8ec. Root cause of the stalled revenue sensor (revenue_usd_corrected=0.90702, need >= 1.0, gap 0.093): ~/.hermes/scripts/x402_revenue_sensor.py scans OLDEST-first and its cursor newest_scanned=50830131 has not moved since 2026-10-29 (card t_aaafb8ec recorded the same block). That block sits BELOW the free-RPC archive wall: probed live 2026-11-05, base-rpc.publicnode.com returns "Archive requests require a personal token" for blocks 50950867 and 50850867 but returns valid results for blocks 51150867, 51350867 and every window up to tip 53550867. So the scan can NEVER advance past the wall (the 403s) and t_aaafb8ec's fallback chain cannot help: probed same day, 1rpc caps getLogs at 50 blocks, blastapi at 10 blocks, drpc at 10k blocks, ankr needs an API key, meowrpc has no eth_getLogs, mainnet.base.org is rate-limited, llamarpc is 525.

METHOD (adopt existing, additive): (1) Re-anchor the cursor to the wall: binary-search the lowest block publicnode serves (between 50950867 and 51150867), set scan start there. (2) Query USDC Transfer logs with topics [Transfer, null, padded payTo wallet 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10] so results are only inbound payments; probed a 50000-block window returns fine, so use 50k chunks (about 40 calls cover wall to tip). (3) Record the unscannable sliver (genesis to wall) as pre_wall_unscanned in latest.json and fall back to balanceOf-delta reconciliation for it, never silently counting it as scanned. (4) Report total_external_usdc honestly even if unchanged.

WHY: status quo makes zero progress (cursor frozen 7+ days, 2.72M blocks, about 63 days of settlements invisible, including the window where wallet-screen, funding, preflight and receipt-verify routes shipped). New method sees about 2.5M of those 2.72M blocks in one run. GAP-CONTRIBUTION: metric sits 0.093 below threshold; about 48 settled calls at 0.004 closes it. Unseen window is ~92 percent of the blind span; if even ~23 external 0.004 settlements landed in it the milestone flips to met, and if none did the card definitively proves the measurement-blind hypothesis false (an equally valid, decision-grade outcome that settles PARK vs continue).

FILES: ~/.hermes/scripts/x402_revenue_sensor.py (additive, old path behind flag), ~/.hermes/data/x402-revenue/scan_state.json (backward compatible schema), new tests/test_revenue_sensor_wall.py. No src/, no money code, no signing, no paid RPC, keyless public endpoints only.

ACCEPTANCE: CHECK: python3 -c "import json;d=json.load(open('/home/rez/.hermes/data/x402-revenue/scan_state.json'));assert d['newest_scanned']>=53500000, d['newest_scanned']"
SECONDARY (also graded):
CHECK: python3 -c "import json;d=json.load(open('/home/rez/.hermes/data/x402-revenue/latest.json'));assert 'pre_wall_unscanned' in d and d['pre_wall_unscanned']['from_block']<=d['pre_wall_unscanned']['to_block'], d.keys()"
METRIC: unscanned_blocks_above_wall = tip - newest_scanned <= 5000
CHECK: python3 -m pytest -q tests/test_revenue_sensor_wall.py

GUARDRAILS:
  - isolated worktree only
  - additive-only (no edits to payment/money code or src/)
  - read-only RPC calls, no signing, no spend, no paid RPC
  - never push to repos that are not ours
  - any revenue claim or capital action stays gated to the human
  - report final total_external_usdc honestly even if unchanged; mark t_aaafb8ec superseded with this card id as evidence

TYPE: build
BUDGET: --max-runtime 2400
