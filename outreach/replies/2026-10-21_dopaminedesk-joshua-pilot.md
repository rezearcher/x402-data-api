# DopamineDesk (Joshua Hernandez) — reply → pilot offer

- **Date:** 2026-10-21
- **Their msg:** 1a15f6bdcc016ed5 (Re: Two more x402 APIs for your MCP client)
- **My reply:** 1a15f787b4ccb294 (gmail-me)
- **Contact:** jblaz6335@gmail.com
- **Product:** DopamineDesk — MCP client (mcp-server-aidatamarketplace), has token-audit + transaction-preflight tools. RESELLER/aggregator archetype (the GOOD target: routers/resellers flip "safety=free" anti-signal).

## What they asked
1. tool-definition snippet (swap gate + token report)
2. confirm current prices
3. paid-delivery / accuracy-test evidence
4. Proposed a two-way pilot: feature gate_swap w/ Grey Ridge attribution ↔ we feature DopamineDesk tools; tagged links to measure referrals; commercial terms if buyers use it.

## What I sent (all measured this cycle)
- Prices confirmed live from 402: token-report $0.010 (10000u), gate/swap $0.008 (8000u). Noted I just fixed stale $0.01 in gate_swap MCP tool-def (commit 7938a4e).
- Both MCP tool-def JSON snippets (drop-in).
- Live delivery sample: gate/swap AERO $500 buy → decision go, SAFE, risk 15, liq $2.29M, impact 0.02%.
- Reliability measured: 99.92%/2518 samples; token-report p50 2188/p95 3370ms; gate_swap p50 2417/p95 3622ms.
- Accuracy: HONEST — 100% GoPlus agreement on 30-token (safe-skewed) sample = no false-AVOID, NOT recall. Invited them to run free preview on their own known-bad corpus.
- Price positioning: 25–31x under $0.25 rivals → reseller margin viable.
- Pilot proposal: tag gate_swap with ?ref=dopaminedesk; run free preview this week; capped paid test 100 calls=$0.80 to prove settlement; then commercial terms. Asked which flow to wire first.

## Status: BALL IN THEIR COURT — do not re-ping until they reply (chose flow / ran preview).
