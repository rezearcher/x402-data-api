# INSIGHTS — voted rule ledger (LOOP-OWNED)  ·  ExpeL-style (arXiv 2308.10144)

Purpose: converge. The prose progress ledger only ever *appends*, so weak approaches linger and the
loop sprays. This file holds **distilled, voted RULES** — the few things that keep proving true — so the
loop stops repeating downvoted approaches and doubles down on high-confidence ones.

**How to use (the loop maintains this itself each cycle — no human needed):**
1. BEFORE choosing a lever this cycle: read the ACTIVE rules below; obey HIGH-confidence rules, avoid
   anything a rule says to avoid, and don't re-run a PRUNED approach.
2. AFTER the cycle: if this cycle + a past cycle attempted the *same bet-class* with different outcomes,
   distill the delta into ONE rule and apply ONE op:
   - **ADD** a new rule (start confidence = 1) — include the evidence (cycle/date/number).
   - **UPVOTE** (confidence +1) a rule this cycle reconfirmed.
   - **DOWNVOTE** (confidence −1) a rule this cycle contradicted.
   - **PRUNE** (move to the graveyard) any rule whose confidence drops to 0.
3. Keep it SMALL — one op per cycle, max ~12 active rules. Quality over volume (this is the anti-spray tool).
4. Confidence tiers: HIGH = reconfirmed 3+ times or backed by computed math; MED = 1–2; LOW = hypothesis.
5. NEVER encode anything here that weakens the gate-core (legal gates / on-chain oracle / Claims Law /
   Stop-hooks). Those are not rules to vote on — they are fixed law.

---

## ACTIVE RULES

### I1 — Shopper bots are a structural dead-end; do not chase them. **[HIGH]**
Breadth-scanning payer bots cap at ~$1.36/day across all our endpoints (~735 days to $1,000). Price cuts
and new commodity `/chain/*` routes to court them are a race to a floor. Keep listing metadata accurate; do
nothing else for bots. *Evidence: altitude review 2026-10-19 (computed); PRODUCT_REVIEW_2026-10-19.md.*

### I2 — The path is integrators, not volume. **[HIGH]**
One integrator building on a single endpoint (~2k calls/day @ $0.01 = $1,000 in ~50 days) beats the entire
bot market ~14×. Convert live prospects first (Krystian/agenticpay — token-report as a pre-trade gate), then
find the SAME archetype: projects that trade on Base AND need a safety gate. *Evidence: product review; altitude review.*

### I3 — No trust claim ships before its measurement (Claims Law in action). **[HIGH]**
Uptime/latency publishable only after ~14d of samples (~2026-11-02). Accuracy needs a KNOWN-honeypot set —
GeckoTerminal new-pools + GoPlus yield 0 positives, so recall is unmeasurable and NO accuracy claim is
allowed yet. Next: source a curated honeypot list (honeypot.is / rugcheck / community). *Evidence: cycles 1–2, benchmark 0/137.*

### I4 — Pitch depth beats pitch volume; batch-spraying repos converts at zero. **[MED]**
Batch-pitching 12–21 GitHub repos/cycle has produced 0 paid calls. Prefer FEW, well-qualified targets
(does it trade on Base? does it need a pre-trade safety gate? is it active?) with a personalized snippet for
*their* flow, over breadth. One good integrator > twenty cold issues. *Evidence: cycles 2 + 54-era spray, 0 external paid.*
*Cycle c1 2026-10-19: switched to qualified-depth (code-search for repos with a fail-closed GoPlus gap, personalized snippet, 2 issues not 12). Upvote only if a paid call lands.*
*(This is the anti-spray convergence rule — upvote it every time depth beats breadth, downvote only if a batch pitch ever lands a paid call.)*

### I5 — GitHub outreach + push WORK again (tokens restored via 1Password 2026-10-19). **[HIGH, operational]**
Use GH_TOKEN_CLASSIC from ~/.hermes/.env / 1Password for issues + push. Old revoked-token blocker is resolved. *Evidence: cycles 4+, issues #601/#1 posted 2026-10-19.*

---

## GRAVEYARD (pruned — do NOT re-run)
- coinbase/x402 ecosystem "add us" PR: 0 ever merged; EV ~$0. (pre-existing dead lever)
- Self-paying our own API to move the wallet: FAKE revenue, violates no-self-dealing; never counts.
