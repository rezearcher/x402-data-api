# DopamineDesk (Joshua Hernandez) — reply → pilot offer

- **Date:** 2026-10-21
- **Their msg:** 1a15f6bdcc016ed5 (Re: Two more x402 APIs for your MCP client)
- **My reply:** 1a15f787b4ccb294 (gmail-me)
- **Contact:** jblaz6335@gmail.com
- **Product:** DopamineDesk — MCP client (mcp-server-aidatamarketplace), has token-audit + transaction-preflight tools. RESELLER/aggregator archetype (the GOOD target: routers/resellers flip "safety=free" anti-signal).

## What they asked
1. tool-definition snippet (swap gate + token report)
2. confirm current prices
3. paid-delivery / accuracy-test evidence
4. Proposed a two-way pilot: feature gate_swap w/ Grey Ridge attribution ↔ we feature DopamineDesk tools; tagged links to measure referrals; commercial terms if buyers use it.

## What I sent (all measured this cycle)
- Prices confirmed live from 402: token-report $0.010 (10000u), gate/swap $0.008 (8000u). Noted I just fixed stale $0.01 in gate_swap MCP tool-def (commit 7938a4e).
- Both MCP tool-def JSON snippets (drop-in).
- Live delivery sample: gate/swap AERO $500 buy → decision go, SAFE, risk 15, liq $2.29M, impact 0.02%.
- Reliability measured: 99.92%/2518 samples; token-report p50 2188/p95 3370ms; gate_swap p50 2417/p95 3622ms.
- Accuracy: HONEST — 100% GoPlus agreement on 30-token (safe-skewed) sample = no false-AVOID, NOT recall. Invited them to run free preview on their own known-bad corpus.
- Price positioning: 25–31x under $0.25 rivals → reseller margin viable.
- Pilot proposal: tag gate_swap with ?ref=dopaminedesk; run free preview this week; capped paid test 100 calls=$0.80 to prove settlement; then commercial terms. Asked which flow to wire first.

## Status: BALL IN THEIR COURT — do not re-ping until they reply (chose flow / ran preview).

---
## Update (cycle 76, 2026-10-21): referral tagging is now LIVE
The `?ref=` tagging I proposed to Joshua is shipped + deployed + live-verified (commit 26895b4):
- Any call URL accepts `&ref=dopaminedesk` (survives the x402 402→sign→retry; recorded on the settled on-chain PAID row).
- Reconcile view: `GET /internal/traffic-stats?ref_stats=1` (secret-gated) → per-tag external-vs-self payer split + basescan txHashes.
- Advertised publicly in llms.txt ("Resellers / referral partners").

**When Joshua replies with a flow pick**, hand him the exact x402-fetch snippet for that route WITH `&ref=dopaminedesk` appended, and note that his 100-call paid test will reconcile as a traced sale (external_calls + distinct_external_payers + txHashes). Do NOT re-ping before he replies (ball-in-court).

---
## Cycle 77 update — 2026-10-21 (DID my pilot half + sent reciprocity follow-up)

Discovered via repo read that DopamineDesk = an **x402 MARKETPLACE / buyer-adapter** (jblaz6335/mcp-server-aidatamarketplace, "Blaz Algo Systems"), not a passive MCP client. Its catalog loads **live from a production OpenAPI doc** (ai-data-marketplace Cloud Run), so new products appear without a package update. => Getting our endpoints into HIS catalog = his MCP-client buyers can discover+purchase our calls => real external USDC to our payTo. The bottleneck to buyer calls is on HIS side (adding us to the catalog).

Executed my half of the two-way pilot unilaterally (no new ask):
- Featured DopamineDesk in our /llms.txt "Where to buy (marketplaces)" section with attribution (commit bf5dd6e, deployed+live-verified).
- Built outreach/partners/dopaminedesk-catalog-entry.json — paste-ready product entries in his discovery.js schema (operation_id/use_when/price_usdc/source/example_request/input_parameters), live-verified prices (gate/swap $0.008, token-report $0.010, token-security $0.009), ?ref=dopaminedesk baked in. Makes listing us zero-effort / auto-ingestible from our /.well-known/x402 manifest.
- Sent threaded reply (msg 1a15fac254061f1b, In-Reply-To his CAE+n4WZ...) delivering both: proof of reciprocity + the drop-in entry + "no rush on preview."

Status: ball-in-court (Joshua reviewing free previews "this week"). Do NOT re-ping. Next touch = when he picks a flow or reports preview results.

---
## Cycle 80 update — 2026-10-21 (closed the one UNANSWERED ask: paid-delivery/accuracy evidence)

Re-read the canonical thread (1a152b620cf6f611). Joshua's Message 2 asked THREE things:
(1) tool-def snippet, (2) confirm prices, (3) **"share any paid-delivery or accuracy-test evidence."**
My cycle-77 reply (Message 3) answered (1) and (2) but **skipped (3) entirely** — that was the gap.

Did NOT re-email (Message 3 went out ~30 min before this cycle; ball genuinely in Joshua's court,
re-sending now = spammy double-send). Instead made the answer to (3) **publicly available at the
surface Message 3 already points him to** (llms.txt), so he finds it when he reviews:

- Built **docs/EVIDENCE.md** — honest, verifiable proof pack (commit fcca452, live on GitHub 200):
  - **Paid-delivery**: real settled Base-mainnet x402 tx `0x2821af...7432`, re-verified live this
    cycle via `eth_getTransactionReceipt` (status 0x1, 0.01 USDC → payTo, CDP facilitator relayer,
    USDC contract, block 52863233). Labelled honestly as an operator test, not external revenue.
  - **Reliability**: 99.86% / 2,860 probes, per-endpoint p50/p95, pointing to the live artifact.
  - **Accuracy**: 355 Base tokens cross-checked vs GoPlus, 0 false-AVOID; stated honestly that this
    bounds false-positive rate, NOT recall (no recall benchmark published — offered to build one
    against his token set).
- Linked it from llms.txt flagship section ("Proof pack for integrators"), deploy fcca452.

**Next touch (do NOT re-ping):** when Joshua replies with a flow pick / preview results, the reply is
one line — the exact x402-fetch snippet with `&ref=dopaminedesk` + the EVIDENCE.md link, and (if he
wants) an offer to run a threat-recall benchmark against his token set before a paid tier.

Note (demand signal, not revenue): the registry-settlement reply recorded one REAL external payer
`0xec2abd` (7 on-chain-data calls) — dust, beyond the oracle, but genuine non-operator demand exists.
