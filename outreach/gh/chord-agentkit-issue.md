An AgentKit agent that can call your swap action will happily swap into a honeypot if the LLM asks it to. A pre-swap guard action pairs naturally with `chordActionProvider()`: `/gate/swap` (Grey Ridge, Base) takes `token`, `side`, `notional_usd` and returns one `decision: go|hold|block` plus `risk_score`, `liquidity_usd` and flags, from a live sell-simulation + liquidity + admin-control check.

Free, no wallet (3 real-token checks/IP/day):
```ts
const r = await fetch(`https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=${tokenOut}`);
const { decision, risk_score, flags } = await r.json();
if (decision === "block") throw new Error(`gate/swap blocked: ${flags.join(",")}`);
```
Paid (unattended) route is $0.008/call USDC on Base via x402 — AgentKit already has `x402ActionProvider`, so the agent can pay it with its own wallet. If you want it, I can PR a small `chordGuard` helper that wraps the swap action with this check (opt-in, off by default). Which token pair would you like me to run through it first?
