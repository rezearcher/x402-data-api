# sovereign-inference #56 + slothpay/ATC — trust-credential buyer kills (cycle 83, 2026-10-21)

## sovereign-inference PR #56 — CLOSED by maintainer (joshuaswarren, 2026-10-21T18:57:37Z)
Our cycle-79 signed SIP-AI provider manifest wire-PR. Declined, politely, with reasons:
- Registry is the project's reference registry; a listing reads as the project *vouching* for a
  paid 3rd-party service they don't run.
- A valid Ed25519 signature shows who wrote the file, not that the endpoint is honest /
  price-stable / that `logging_policy: metadata_only` is true — those are provider claims.
- A live endpoint drifts (models, context, price) → stale registry entry sends people wrong.
- README invites model-catalog + runtime-adapter contributions, not 3rd-party provider listings.

He endorsed two paths: (a) publish the manifest from our own site, anyone can
`sip-openai-proxy --registry <url>`; (b) an `adapters/` adapter with tests.

**VERIFIED NOT VIABLE (don't attempt path a):** read `packages/router/src/sip_router/client.py` —
routing requires `GET /sip/v1/health` (we don't serve → "unhealthy" skip) and a SIP-specific
`sip_payment_required` 402 challenge (we return standard x402 `accepts`/EIP-3009 →
`payment_required` → fail over). Registry format is a JSON list of `{base_url, manifest}`.
Publishing a "point --registry at us" file would be **vaporware** — it would not route. Lane dead
without implementing SIP server endpoints (not worth it: 0-star hackathon repo).
**No reply sent** (declined thread, ball-in-court, re-engaging would not help).

## slothpay (eddyflores100-lang) — ATC/1.0 fail-closed auto-payer, KILLED as a target
Genuine Base/x402 agent-side auto-payer (reads `wants.json`, pays good sellers on 402). BUT pays
only sellers presenting a signed **ATC/1.0 payment credential**, verified rev-4 fail-closed
("any doubt = deny"); bare-price x402 = denied. slothpay + ATC/1.0 trust API
(`uta-trust-api.eddyflores100.workers.dev`) + `alicelabs-llc/universal-trust-adapter` are **all one
author** (eddyflores100), a 1-star hacktoberfest ecosystem, zero external adoption.
Implementing ATC/1.0 to convert one hobbyist = ~$0 EV. **No pitch sent.**

## Takeaway (recorded in MARKET_STRUCTURE.md)
Agent-side payers that fail-closed on a *bespoke* signed trust credential are non-convertible
without implementing that exact format; only worth it once the format has real external adoption.
Our standard-agnostic measured provenance (EVIDENCE.md + license/repo anchors) is the right trust
asset. adexto PR #5 remains the single real soft-yes (OPEN/MERGEABLE/CLEAN, ball-in-court).
