# Market-data decision-buyer example — 2026-10-21 (cycle 66)

**Lane:** B (reduce replied→paid friction for the best-matched demand archetype).
**Gate:** contacted→replied leak, "improve targeting." All warm leads ball-in-court
(adexto#5, shipyard#34, Decision402#5, ClawRouter#503, ampersend#149, x402-registry#19)
— nothing to answer, re-ping = spam. New replies all NOs (token-safety dead / chain-mismatch).

## What shipped
`examples/market-data-decision-buyer.mjs` (commit c089f35, deployed + live-verified).
The runnable example an agent framework needs to buy a price via x402 and never
present stale data as real-time — the **Decision402 archetype** (2042458785/Decision402#4:
"Add a real-time market data x402 service", the single best-matched demand signal in the
buyer-intent feed). Full decision loop:
1. DISCOVER — read the live 402 quote (price/asset/network) before paying.
2. BUDGET — reject if quoted price > MAX_USDC.
3. PREVIEW — hit the free `/crypto/prices/preview` to prove liveness, no wallet.
4. PAY — settle USDC on Base inline via x402 (EIP-3009 gasless).
5. FRESHNESS — parse `timestamp`, reject rows older than MAX_AGE_SECONDS.
6. REPORT — structured record (price, currency, source, update time, amount paid, receipt).

Lazy viem/x402-fetch import → steps 1-3 run with **zero npm installs**.

## Verified live
- `node examples/market-data-decision-buyer.mjs bitcoin,ethereum` → quote 0.001 USDC,
  budget ok, preview live (no wallet).
- `MAX_USDC=0.0001 ... bitcoin` → budget gate fires, exit 2.
- llms.txt + README link the example; GitHub raw blob 200; tsc clean; desc-limit OK.

## Why this (not a re-ping)
Decision402#4's "Done when" checklist IS a spec for what any market-data buyer needs.
Shipping it as a durable, reusable repo example (not a PR comment) advances the
replied→paid leak for every future market-data buyer without double-sending anyone.
It becomes linkable the moment any such buyer engages.

## Did NOT do
- Re-ping Decision402#4 (my only comment there, 10-19, got no reply → double-send).
- Push to PR#5 branch (bumps their notifications = soft re-ping).
