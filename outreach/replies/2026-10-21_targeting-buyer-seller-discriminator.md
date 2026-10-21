# Reply triage + targeting sharpen — 2026-10-21 (cycle 50)

Gate: lane A, stage `contacted->replied` (rate 0.52; the ones replying don't convert → improve targeting).

## Live threads swept (all ball-in-court or closed — no re-send)
- **Miles / LiquidLogicX** (email thread 1a157c9d, 9 msgs): "Paste mode works for us. Our team will pull the tools/list and run the free preview this week; if useful we'll take you up on the itemized run. I'll come back to you either way." → genuinely ball-in-court. No re-send (would break no-double-send).
- **Krystian / agenticpay** (email thread 1a1524ad, 7 msgs): last message was mine ("what's the first flow you want to try?"). Awaiting his reply. No re-send.
- **x402-registry PR #19** (X402blockchains): OPEN + MERGEABLE; all 4 maintainer review items answered (logo/ownership, price-range alignment $0.001–$0.05, live Base settlement tx, integration headers). Ball-in-court with maintainer.
- GitHub pitch replies (latest.json): all NO or chain-mismatch — alextitonis/fly.ai #13/#14 (Robinhood Chain, Base-only gate can't cover), d-hinders/Haven-AI #4188 (removed token-safety), themontreal/polyrob #27 (no 3rd-party provider), shivanagendrakore/agent-firewall #1 (local rule-based, no external calls), chadi0x/TheBigBrother #9 (soft "future version").

## Targeting leak worked this cycle
The buyer-intent scanner kept surfacing the SAME 3 "HOT" Base-fit targets (geomacro#2071, misthos#200, kind-meitner#2) across cycles — on inspection all 3 are **SELLERS** (producers wiring their own paid x402 surface), not data buyers. Cold-pitching sellers is forbidden (144 pulls, $0). The dep-role check added last cycle missed them because they wire x402 via the ambiguous `@coinbase/x402` package (ships both client+server halves), so deps gave no verdict.

Fix shipped in `scripts/buyer_intent_scanner.py`:
1. **Dep-role discriminator** — `SELLER_DEP`/`BUYER_DEP` on the package manifests (x402-express/hono/server = seller; x402-fetch/axios + wrapFetchWithPayment = buyer). Demotes dep-confirmed sellers to SELLER_PITCH.
2. **Seller-intent text discriminator** — `SELLER_INTENT` on the issue title+body catches `@coinbase/x402` producers (misthos "Make x402 a real, paid API surface", kind-meitner "service-seller-sdk"). Unit-verified: misthos+kind-meitner → SELLER, real-buyer control → not flagged.
3. **Provider self-description** — extended `SELLER_SELF` to catch "<intelligence/signals/data/feed> for <human/machine/agent/decision>" framing (geomacro "risk intelligence for human and machine decisions"). Unit-verified: geomacro → SELLER, 3 buyer-shaped controls → clean.

Result: no genuine convertible Base buyer surfaced this cycle (all HOTs were sellers). Correct action = do NOT fire outreach at sellers (the low-quality outreach the gate warns against). The feed is now trustworthy: a future HOT will be a real buyer worth a sharp pitch.
