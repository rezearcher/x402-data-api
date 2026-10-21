# ArbiVault PR #44 — wire the PAID /gate/swap fallback (follow-up to merged #40)

**Date:** 2026-10-20 (CDT) / 2026-10-21 UTC
**Repo:** d85rcrcy27-creator/ArbiVault  **PR:** https://github.com/d85rcrcy27-creator/ArbiVault/pull/44
**State:** OPEN, MERGEABLE, +37/-3, 1 file. Branch: rezearcher:feat/paid-gate-fallback-snapshot (commit cda9ddc)

## Why this is the conversion step
- Found via `gh` code search for `x402-data-api.sigrunner.workers.dev` — ArbiVault's live Supabase edge
  function `arbivault-base-wallet-snapshot/index.ts` screens tokens pre-trade using our **free**
  `/gate/swap/preview`.
- PR #40 (MERGED) only *surfaced* the paid upgrade URL in the output; it never calls the paid route.
- The leak: `/gate/swap/preview` caps at **3 real-token checks/day/IP**. A Supabase edge function
  shares one egress-IP pool, so the trial exhausts after a few screens → the snapshot carries NO
  go/hold/block signal. The natural (and only) fix at volume is the paid call.

## What PR #44 does
- Opt-in paid fallback: when `X402_PRIVATE_KEY` is set, an exhausted free trial falls through to the
  metered `GET /gate/swap` ($0.008 USDC on Base, no daily limit, identical response shape).
- Gasless EIP-3009 signing via `x402-fetch@1.2.0` + `viem` (already a dep).
- `X402_PRIVATE_KEY` unset (default) ⇒ byte-identical behavior, no paid call ever.
- Exhausted/paid-error is never a pass (returns null / existing `__exhausted`).

## Ball-in-court
PR is theirs to merge. Owner merged #40 → accepts our PRs. If merged AND they set a funded
`X402_PRIVATE_KEY`, every exhausted screen becomes a real $0.008 paid call to PAY_TO.

## Note for next cycle
- Do NOT re-send to Krystian (5 unanswered follow-ups already), Miles/LiquidLogicX (said "we'll come
  back either way", running preview this week), adexto PR#5 (open, "leaving open"). All ball-in-court.
- Cold outreach FORBIDDEN (144 pulls, $0).
- goal_gate "do first outreach" recommendation is a known false (funnel unit-mismatch).
