# STRATEGY — current aim (LOOP-OWNED, rewritable by the loop itself)

This file is the makemoney loop's **current strategic aim**. The loop OWNS it and
**rewrites it itself** whenever a strategic-altitude review (see `makemoney.goal` →
"STRATEGIC ALTITUDE") finds a better path to the goal. No human approval needed to
change it — only the two legal gates (submit a bounty; deploy capital) ever need Rez.

The **$1,000 external-USDC GOAL is fixed and permanent** (it lives in `makemoney.goal`
and is a deliberately hard riddle — only relentless useful work alleviates it). **THIS
file is only HOW we get there, and it is allowed to change** as the evidence changes.

Read this file EVERY cycle — it is your current aim.

---

## Current aim — set 2026-10-19 (initial product review)

- **TARGET BUYER:** integrators (devs/agents who build on ONE endpoint they depend on),
  NOT breadth-scanning shopper bots. Evidence (computed): bots cap at ~$1.36/day across
  all endpoints (~2 years to $1,000); one integrator at ~2k calls/day = $1,000 in ~50
  days (~14× faster). Full math: `docs/PRODUCT_REVIEW_2026-10-19.md`.
- **PRIMARY LEVER:** convert live integrator prospects (Krystian / agenticpay —
  `/chain/token-report` as a pre-trade safety gate) and find 2–3 more of that archetype.
- **PRODUCT FOCUS:** the trust layer on the composite safety SKU (`token-report`,
  `gate/swap`): uptime/latency (L1/L2), real-token trial (L3), accuracy once a known-bad
  token set exists (L4). Claims Law binding — no unmeasured claim ships.
- **DO-NOT:** price-cut to chase bots; add commodity `/chain/*` routes; ship speculative
  endpoints. Multi-chain stays demand-gated (additive `/chain/eth/*` on a named buyer only).

## Strategic-review log (append one line per review — confirmed OR re-aimed)

- 2026-10-19 — aim set to **integrator-first** (initial product review). Next self-review
  due ~cycle +10, or after ~5 flat-wallet cycles, or when a lever feels exhausted.
- 2026-10-19 (altitude review, flat-wallet trigger) — aim CONFIRMED integrator-first. Computed: bots ~$1.36/day => ~735 days to $1,000; 2k calls/day @ $0.01 => ~50 days; 500 calls/day => ~200 days. Wallet delta +0.583 is mostly our own seeds. Blocking facts: all GitHub tokens revoked (main integrator-reply channel) -> restore token is highest-leverage unlock; email channel capped 15/day. Claims Law unchanged (uptime publish after ~2026-11-02). No new shape justified.
- 2026-10-20 (altitude review, 13 cycles flat) — aim CONFIRMED integrator-first. Computed: bots 735d; 1 integrator@500c/d 200d; @2k c/d 50d; 3 integrators@2k c/d 17d. Demand-side GitHub search is saturated (153 repos pitched, 0 conversions). Refinement: target B2B embedders (pre-sign verifiers like septagos/subcento#1) who can wrap token-report into their own paid verdict — one embedder multiplies call volume. Keep Krystian nudge + queued emails at 05:00Z.
