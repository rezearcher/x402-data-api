# Buyer-demand intel — first identified real buyer + lane pivot (2026-10-21)

## What the ground truth says
Built `scripts/buyer_demand_intel.py` (cronned every 6h via op launcher). It cross-references
our TrafficLog paid feed (`/internal/traffic-stats?paid=1`) with the de-washed ecosystem census
(`~/.hermes/data/x402-demand/buyer_seller_log.jsonl`, 3900 rows). Output:
`~/.hermes/data/x402-demand/buyer_intel_latest.json`.

## Finding (first time identified)
- Our ONE real external buyer: `0xec2abd3eda89bed90124736e317e847d5fb6d034`.
  - Paid us 7 times, **all in the on-chain-data lane**: /chain/balance, /chain/block-number,
    /chain/code, /chain/gas-price, /chain/receipt, /chain/token-balance, /chain/tx (one each).
  - Ecosystem footprint: **32 purchases across 15 distinct sellers** — a real, funded, active
    multi-seller x402 buyer-agent (buyer #12 ecosystem-wide by activity). Already past the
    funded-wallet + x402-client friction and chose us.
  - Access pattern = "inspect one account + one tx" done as 7 separate paid calls.

## Pivot (acts on evidence, not opinion)
- **Demand lane = on-chain data (/chain/*), NOT token-safety.** Every token-safety / MCP-scanner
  cold pitch was rejected this cycle (Kuadrant, VT-Agent-Firewall, guardana, HelpCode/anythingmcp:
  all "we don't call external paid/hosted services"). Stop pitching token-safety as the wedge.
- /chain/* discovery is already healthy: 56 routes in `.well-known/x402`, all tagged
  `onchain/base/rpc/data`. No discoverability leak to fix there.
- Note: our seller wallet does NOT appear in the on-chain census, yet TrafficLog logged 7 paid
  rows from 0xec2abd. Either sub-threshold settlement the census missed, or payments
  verified-but-not-settled. All 7 routes have short descriptions (44–204 chars) so the CDP
  500-char settle bug is NOT the cause. Needs an on-chain confirm (blocked: RPC 403s datacenter IPs).

## Next (evidence-staged)
If a 2nd on-chain buyer appears OR 0xec2abd repeats, ship an additive `/chain/account-overview`
batched route (balance+nonce+code+token-balance in one paid call) — converts a 7-call evaluator
into a 1-call repeat customer at higher per-call value. Held this cycle per the ground rule
(new endpoint wants confirmed repeat demand, not one data point).
