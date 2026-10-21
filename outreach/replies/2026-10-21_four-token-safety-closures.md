# 4 fresh token-safety NOs — 2026-10-21 (cycle 65)

All four are maintainers CLOSING our /gate/swap token-safety pitch. Same two structural
reasons recur, confirming the token-safety lane is dead (free commodity + chain mismatch):

| Repo / issue | User | Verdict | Reason |
|---|---|---|---|
| alextitonis/fly.ai#13 | alextitonis | closed | "token check runs on **Robinhood Chain**, gate is Base-only" + "already use **GoPlus**" |
| alextitonis/fly.ai#14 | alextitonis | closed | GoPlus gap + unindexed-retry are "on purpose"; feed is Robinhood Chain |
| bytesbrains/16ane#81 | nandal | closed | "a third-party **paid** pre-trade gate has no P0/P1 requirement; wallet safety covered" |
| chadi0x/TheBigBrother#9 | chadi0x | closed | polite "future version" soft-no |

## Signal
- fly.ai is a NAMED team on **Robinhood Chain** using **GoPlus (free)** — even an additive
  Robinhood route would not convert (GoPlus already covers it free). NOT a demand signal for
  a new chain route. Stays Base-only (goal rule: multi-chain is demand-gated on a *paying* ask).
- The ONLY positive reply in the 61-reply corpus remains the COMPUTE fallback lane (adexto 0xcuy
  #4: "interesting shape for a fallback/cheap lane"). Compute, not token-safety, is the convertible lane.

## Action taken this cycle (not a re-ping — all four are closed)
- Did NOT re-ping (closed by maintainers; spam to reopen).
- Re-ordered the Circle Agent Marketplace submission description (outreach/blockers/circle-agent-marketplace-form.md)
  to LEAD with compute + market-data and demote token-safety, so the one pending high-value
  buyer-surface submission categorizes us for the convertible demand before first-reg freezes it.
