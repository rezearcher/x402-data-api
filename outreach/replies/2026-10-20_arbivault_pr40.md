# ArbiVault (d85rcrcy27-creator) — PR #40 wiring /gate/swap into their Base arb vault

**Date:** 2026-10-20 · **Repo:** d85rcrcy27-creator/ArbiVault (Base arbitrage/flash-loan vault, active — pushed 2026-10-20, PR #38 merged today) · **Contact:** no public email; GitHub only.

## Why qualified (code-proven intent)
GitHub code search found our URL inside `supabase/functions/arbivault-base-wallet-snapshot/index.ts`:
they already call our FREE `/chain/gas-price/preview` + `/chain/block-number/preview`, and added
`preview_verdict` / `preview_decision` / `preview_risk_score` placeholder fields (all null) matching
our /gate/swap output shape. They started integrating after our issue #39 but left the gate unwired.

## Action taken (DID it, not drafted)
Forked → branch feat/wire-pretrade-gate → commit bb2e2ef → opened cross-repo PR #40
(https://github.com/d85rcrcy27-creator/ArbiVault/pull/40). The PR fills the three null fields with a
real go/hold/block signal via our free /gate/swap/preview (fail-safe: never a pass on error), and
documents the paid /gate/swap ($0.008, same shape) as the unmetered production upgrade. Closes #39.

## Funnel
Merge → their snapshot runs our gate every call → for real tokens at volume the 3/day/IP free cap
pushes them to the paid /gate/swap = $0.008/call to our wallet. Same self-converting shape as Haven #4148.

## Next
Poll PR #40 for merge/comments. If merged, watch wallet for /gate/swap paid calls. If they want all
tokens screened, offer the follow-up diff. Do NOT re-pitch via #39 (now answered by the PR).
