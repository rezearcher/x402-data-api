# X402blockchains/x402-registry PR #19 — review points 1 & 2 resolved (2026-10-21)

**Lead:** X402blockchains (actively-maintained community x402 registry; independently verifies submissions). OPEN, MERGEABLE listing PR for Grey Ridge market-data API.
**Their ask (2026-10-21T16:48Z):** before approval — (1) add an actual redacted successful resource RESULT for `GET /chain/token-report` tied to the verified payment, distinct from payment evidence; (2) correct the retry guidance (a side-effect-free GET is not automatically safe to PAY again).

**Done this cycle:**
- Pushed commit `dd0656e` to branch `list-greyridge-market-data` (fork rezearcher/x402-registry):
  - New section "Payment evidence vs. delivery evidence" — real live `GET /chain/token-report` JSON body (captured 2026-10-22T00:47:19Z), with the decoded `X-PAYMENT-RESPONSE` receipt tying body↔tx.
  - New section "Timeout, uncertain settlement & result recovery" — EIP-3009 single-use nonce semantics; confirm settlement before any new authorization; recover lost result via same authorization or `contact@` with the tx; never a fresh paid call on a mere timeout.
  - Checklist items 1 & 2 marked ✅.
- Replied on PR: https://github.com/X402blockchains/x402-registry/pull/19#issuecomment-6329949640

**State:** ball-in-court on reviewer (they said "we will recheck before approval"). Approval = live listing on a verifying registry = real organic discoverability. DO NOT re-ping until they respond.
