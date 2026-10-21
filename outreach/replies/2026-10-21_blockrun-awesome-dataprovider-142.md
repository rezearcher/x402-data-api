# BlockRun awesome-blockrun — data-provider onboarding (issue #142)

**Date:** 2026-10-21 (cycle 68)
**Target:** BlockRunAI/awesome-blockrun (the "Discovery Layer for AI Agent Payments" — a *paying* x402 router/aggregator on Base + Solana; 88 LLMs + DEX + prediction-market data, charges $0.0085/call and routes to partners)
**Surface:** issue #142 — https://github.com/BlockRunAI/awesome-blockrun/issues/142
**Template followed:** Predge issue #135 (Amir's data-provider proposal for Community Integrations) — the maintainer-validated onboarding path.

## Why this is well-qualified targeting (gate: contacted->replied / improve targeting)
BlockRun is a **reseller/router**, not an end-consumer. For a router, our value = catalog breadth they resell at margin + a per-request fee — so the "token-safety is a free local commodity" anti-signal that killed every direct token-safety pitch (ARPAHLS, fly.ai, agent-discover) **does not apply**: a router doesn't self-consume safety, it routes paid calls to us and takes a cut.

## Pitch shape
- Led with the **catalog gap**: BlockRun routes trades + DEX/prediction data but has NO "is this Base token safe to touch" verdict → `/gate/swap` ($0.008) + `/chain/token-report` ($0.01) are a natural pre-trade leg.
- Complementary market data: `/crypto/prices` $0.001, `/crypto/funding` $0.004, `/scan/mcp` $0.05, `/v1/chat/completions` $0.002.
- Live 402 proof cited (payTo 0x5765…ed10, eip155:8453, USDC), discovery manifest `.well-known/x402` (62 resources), measured 99.92% uptime @ /status.
- **Bundled with the already-open ClawRouter PR #503** (adds /gate/swap to PARTNER_SERVICES) → onboarding = one server-side proxyPath→host map, nothing for them to build.

## Status: ball-in-court (BlockRun to triage). Do NOT re-ping.
Both BlockRun surfaces now open: awesome-blockrun#142 (discovery/curation front door) + ClawRouter#503 (runtime wiring). Watch for maintainer reply/label; respond only with measured value.
