# Money Loop — the margin thesis + the 6-personality crew (design, not yet wired)

**2026-10-21, KAIROS + Rez.** This reframes the money loop from *seller-of-a-listing* (the
$37/day token-safety desert) to *buyer-and-reseller that owns a margin* — and gives it a small
crew of personalities so the hunt is pressure-tested, not agreed-to-agree. Nothing here is wired
into `makemoney.goal` yet; this is the approved design to build next.

## The thesis (Rez), corrected by research
The money on x402 is **human, and the winners keep a spread.** BlockRun (the #1 Base x402 data
earner) runs it: **ClawRouter is free + local + MIT** (the hook), the paid backend routes over
x402, and they **keep $0.009 of every $0.01**. The win is not a listing agents discover; it is a
product with an audience, buying cheap x402 wholesale and reselling a finished outcome.

Three framings, ranked by what the evidence supports:
- ❌ **Build "OurGPT" / a site that is impossible-without-x402.** Weakest. "Impossible because
  x402" is a *backend* fact users never see or benefit from; a new consumer site dies on
  distribution. The capability is not the moat — the **audience** is.
- ⚠️ **Acquire a site and swap in cheaper x402.** Right shape (buy the audience + cut COGS), but
  the arbitrage exists **only where per-use COGS is high** — AI-wrapper sites paying frontier-model
  retail — not generic micro-SaaS (already ~95% margin on a $12/mo API bill). Capital-gated on the
  buy; the free probe is a COGS-cut rev-share offer to an existing operator.
- ✅ **Be the margin-capturing gateway — BlockRun for a vertical where we can get an audience.**
  Free useful tool + hook → paid backend routed to the cheapest x402 supply (ours + others') →
  **user pays FIAT, x402 invisible** (kills the human stablecoin-checkout/KYC friction objection).
  Spread = fiat retail − x402 wholesale − fees. Near-zero marginal cost, uncapped upside → convex.

**Principle (not the literal example):** flip **seller → buyer-and-reseller**. Buy cheap x402
supply, resell a finished outcome to an audience at 10–100×, x402 invisible. *This is the arb-loop
move applied to business:* the alpha is cheap x402 wholesale; the venue we migrate it to is a
human/prosumer product where the same capability sells for far more. **Buyers, not listings — by
becoming the thing that already has buyers.**

**First line of inquiry for the loop (a hypothesis to prove or kill, NOT a mandate):** be BlockRun
for our adjacent vertical — a free installed tool for crypto/trading/agent devs (we already ride the
255K-star NousResearch/hermes-agent catalog + own data/safety/inference routes), metering a premium
x402-routed backend, fiat on the front. Also test the acquire-and-reback variant against real
AI-wrapper listings (Acquire.com/Flippa) where inference COGS is high. **Distribution is evaluated
FIRST, every time.**

## The crew — 6 personalities (sweet spot; ≤8 hard cap)
Today: 1 worker + 1 judge. Each new seat is justified by a specific failure the research exposed.

1. **Scout** (research pre-phase) — maintains competitor/winner/customer-need registries; studies
   WHO makes money and HOW (channel, COGS, margin); emits ranked margin-play candidates with
   evidence. Fixes: re-deriving rivals every cycle; the 75-day-stale landscape.
   *Output contract:* ≥1 candidate or registry update with a source; never "web-searched, found rivals."
2. **Distribution/Growth** — owns the only question that killed 100+ cycles: where does the audience
   come from? No candidate advances without a NAMED, cheap distribution channel + evidence it exists.
   *Output contract:* a channel with a reach estimate, or the candidate PARKS.
3. **Economist** — COGS vs retail, spread, CAC/LTV, break-even, barbell (bounded downside), computed
   IN CODE, never mental. *Output contract:* a unit-economics table; a candidate that can't math to
   the goal is demoted, with the number shown.
4. **Skeptic / Red-team** — adversarially attacks each candidate: is x402 actually cheaper here? does
   the audience really exist? margin survive fees+friction+churn? Kills agree-to-agree.
   *Output contract:* an explicit kill-reason OR a survive-verdict with the assumption it rests on.
5. **Builder/Operator** (today's worker) — ships the tool/site, wires x402 backend + fiat front,
   converts warm leads, does outreach. *Output contract:* a shipped artifact (commit/url/send), run
   through the send-gate.
6. **Judge/Oracle** (exists) — no-cheat gate: progress = confirmed external USDC exceeding backend
   spend, not activity. *Output contract:* GOAL ADVANCED only on a verified external transfer.

Flow: **Scout finds → Economist sizes → Skeptic attacks → Distribution proves the audience →
Builder ships → Judge confirms.** Lean-5 option: merge Economist into Skeptic. Recommended: 6
(distribution and unit-economics are different skills and both are historic blind spots).

## Reframed loop goal (to go into makemoney.goal)
> Hunt and build the x402-margin product. Find where cheap x402 supply (ours + others') can be
> resold to a real audience at a markup, with x402 invisible on the backend and the audience/
> distribution proven FIRST. A win is confirmed external money that exceeds backend spend — not a
> listing, not a pitch, not a self-pay. The $1,000/day external-USDC oracle is unchanged and
> remains the only definition of progress.

Mandated pre-phase each cycle (like the arb loop's turn-mode + queue-first): Scout refreshes the
registries and drains a demand-driven research queue; Distribution + Economist + Skeptic must sign
off a candidate before Builder spends a cycle on it; Judge rules on money.

## Convex-barbell & gates
- Gateway play: near-zero marginal cost (Workers + existing routes), uncapped upside — passes.
- Acquire-and-reback: capital-gated (the purchase) — Rez atom; the COGS-cut rev-share *offer* is free.
- Fiat front needs a rail (Stripe tooling available) — build-time, not a capital gate.
- Legal gates unchanged: deploy capital / submit anything = Rez only.

## Build order when greenlit (pause loop → build → verify → resume)
1. Research substrate: competitor/winner + customer-need registries + demand-driven research_queue
   (consolidate existing `scripts/competitor_payto.json`, `competitor_buyer_targeting.py`,
   `x402_landscape`; refresh the stale landscape).
2. Wire the 6 personalities + the mandated pre-phase + the reframed goal into `makemoney.goal`
   (keep the oracle + send-gate).
3. Seed the first margin-play candidate (the BlockRun-for-our-vertical hypothesis) into the queue
   with explicit charters, and let the crew prove or kill it.
