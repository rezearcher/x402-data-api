# BlockRunAI/ClawRouter #503 — resolved coderabbit "gateway 404" review flag

- Date: 2026-10-21 (cycle 64)
- PR: https://github.com/BlockRunAI/ClawRouter/pull/503 (OPEN, adds `/gate/swap` token-safety to PARTNER_SERVICES)
- Comment posted: https://github.com/BlockRunAI/ClawRouter/pull/503#issuecomment-6318828286

## What coderabbit flagged
Automated review set Merge Risk = Moderate: "The new token-safety tool currently reaches a gateway 404 rather than the partner endpoint. Confirm the route mapping before merging."

## Root cause (verified from their source, not assumed)
`src/proxy.ts:2360` — the local proxy forwards EVERY partner path to `${BLOCKRUN_API}${req.url}` i.e. `https://blockrun.ai/api${path}`. So `blockrun_gate_swap` → `https://blockrun.ai/api/v1/gate/swap`, which 404s until the **BlockRun gateway** registers `/gate/swap` as a partner route (exactly how `/pm/*` Predexon is registered server-side). The OSS repo only contains the forwarding proxy + tool definitions (`src/partners/{registry,tools}.ts`); the proxyPath→host map lives on blockrun.ai's server. **The 404 is expected and the PR is complete at the OSS layer** — the mapping is the maintainer's irreducible server-side step.

## What I handed them (removes the friction)
- The exact one-line server-side mapping: `/v1/gate/swap → GET https://api.greyridgesignals.ai/gate/swap` (forward token/side/notional_usd), x402 exact / eip155:8453 / USDC / payTo 0x5765ae… / $0.008.
- Live 402 proof captured this cycle: `curl -i .../gate/swap?...` → HTTP 402, x402Version 2, amount 8000 (=$0.008, matches registry entry), network eip155:8453, payTo our wallet. Confirms their existing `@x402/fetch` flow signs+settles with no new payment code.
- Offered to reshape price/inputs/path to their partner conventions.

## Status
Ball fully in maintainer's court (needs the server-side route registration on blockrun.ai gateway — theirs, not a PR I can make). Do NOT re-ping. Watch for merge + a maintainer reply asking for reshape.
