Clodds' token-security audit is GoPlus-backed, and GoPlus is a lookup database: a freshly launched Base token (exactly what the Clanker/Virtuals launch flows trade) often has no record, so the audit returns nothing to gate on. Grey Ridge `/gate/swap` is a second, independent signal for the pre-trade-validation path: it does a live sell-simulation + liquidity + admin-control check from Base chain state and returns one `decision: go|hold|block` with `risk_score`, `liquidity_usd` and flags.

Free, no wallet (3 real-token checks/IP/day), usable as a fallback when GoPlus has no data:
```ts
const r = await fetch(`https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=${tokenAddr}`);
const { decision, risk_score, flags } = await r.json();
if (decision === "block") throw new Error(`pre-trade gate blocked: ${flags.join(",")}`);
```
Unattended route is $0.008/call USDC on Base via x402 (same path minus `/preview`), which fits Clodds' existing x402 payer. Name a Base token you'd like checked and I'll paste the full result here.
