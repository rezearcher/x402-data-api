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
allowed yet. Next: source a curated honeypot list (honeypot.is / rugcheck / community). *Evidence: cycles 1–2, benchmark 0/137; cycle c4 widened to sell_tax>=0.5/cannot_sell_all over new+trending+top pools: 0/188 positives. GoPlus-labeled recall is a dead end — need an external curated rug list (rugcheck/community) or skip accuracy claims.*

### I4 — Pitch depth beats pitch volume; batch-spraying repos converts at zero. **[MED]**
Batch-pitching 12–21 GitHub repos/cycle has produced 0 paid calls. Prefer FEW, well-qualified targets
(does it trade on Base? does it need a pre-trade safety gate? is it active?) with a personalized snippet for
*their* flow, over breadth. One good integrator > twenty cold issues. *Evidence: cycles 2 + 54-era spray, 0 external paid.*
*Cycle c1 2026-10-19: switched to qualified-depth (code-search for repos with a fail-closed GoPlus gap, personalized snippet, 2 issues not 12). Upvote only if a paid call lands.*
*(This is the anti-spray convergence rule — upvote it every time depth beats breadth, downvote only if a batch pitch ever lands a paid call.)*

### I5 — GitHub outreach + push WORK again (tokens restored via 1Password 2026-10-19). **[HIGH, operational]**
Use GH_TOKEN_CLASSIC from ~/.hermes/.env / 1Password for issues + push. Old revoked-token blocker is resolved. *Evidence: cycles 4+, issues #601/#1 posted 2026-10-19.*

### I6 — For a silent issue on an ACTIVE well-starred agent, escalate to a working-code PR in their conventions. **[LOW, unproven]**
Franklin#213 (issue) got no reply; shipped PR #214 (BaseTokenGate tool, tests 918/918, walletMayPay-gated). Upvote only if a maintainer engages or a paid call lands; downvote if ignored ~7d. *Evidence: cycle c3 2026-10-19.*

### I7 — Bazaar semantic search does not surface token-report; catalog text is stale and refresh needs a settled payment. **[LOW]**
scripts/bazaar_rank.py (CDP /discovery/search, limit<=20): of 9 buyer-style queries only "pre-trade safety gate" returns us (gate/swap rank 9/13); "token security honeypot", "rug pull", "is this token a scam" return none of ours. Bazaar entries are keyed to the workers.dev host and still carry the pre-edit description (lastUpdated 10-19 11:02) though the live 402 on api.greyridgesignals.ai has the new text. Refreshing the index needs a settled payment = self-pay, which is forbidden, so do NOT re-seed. Discovery via Bazaar is a weak lever; integrator replies remain the path. *Evidence: cycle 2026-10-19 (last).*

### I8 — Answer an integrator's reliability/uptime question with measured-so-far + failover; never go silent on it. **[HIGH]**
Krystian/agenticpay asked latency + uptime + free-tier; we DID answer uptime but WEAKLY ("no SLA, small service"). Claims Law blocks a published SLA until ~14d samples, but that is NOT a reason for silence: answer with what's true TODAY — the uptime sensor's measured-so-far success%/p50/p95 (data/uptime_samples.jsonl + ~/.hermes/data/x402-data-api-uptime/latest.json, ~0 failures, n>100) PLUS the multi-provider RPC failover design (README, "never fails a paid call on one provider's rate limit"). General rule: when a prospect asks X and we OWN an asset that truthfully answers X, connect them — do not leave workstreams in isolation. His next touch must lead with this. *Evidence: thread 1a1524ad, reply 2026-10-19; uptime sensor live n>100.*

### I9 — HOLDING IS NOT AN OPTION at $0; every cycle ships one concrete improvement. **[HIGH]**
"Saturation" / "polled replies, nothing new" / "waiting for a reply" is a FAILED cycle, not a valid outcome. The only reason to hold is nothing-left-to-improve, which is false while external revenue = $0. While a reply is pending, still ship ONE of: (a) advance a live conversation, (b) distribution — get embedded where integrators already are (framework tool registries like the LangChain/CrewAI package, their communities), (c) product must-have-ness. Cold GitHub-issue pitches are near-zero-conversion seller-noise — prefer (b)/(c) over more of them. *Evidence: cycle 11 "saturation" = a do-nothing cycle; Rez 2026-10-19 "you always choose nothing".*

### I11 — ONE actor per live thread: the autonomous loop OWNS outreach/sends; a monitor/human session must NEVER also send. **[HIGH]**
On 2026-10-19 the loop (c14c) and the interactive monitor both answered Krystian's uptime question within 12s -> two near-identical emails (thread msg4+msg5) to the prospect. A pre-send thread read does NOT prevent this (the other actor's send lands in the same window = race). Rule: only the loop sends on an active outreach thread; any other session observes and records, never sends. If a human must intervene on a thread, PAUSE the loop first. *Evidence: thread 1a1524ad msg4/msg5, 17:35:24 vs 17:35:36.*

---

## GRAVEYARD (pruned — do NOT re-run)
- coinbase/x402 ecosystem "add us" PR: 0 ever merged; EV ~$0. (pre-existing dead lever)
- Self-paying our own API to move the wallet: FAKE revenue, violates no-self-dealing; never counts.

- I9 (c15, 2026-10-20): CF_WORKERS_TOKEN from `op read op://Division/CF_WORKERS_TOKEN/credential` DOES deploy (v665bb283 then bd94ffb6, gate/swap preview side+notional and "token security" descriptions now live). The cf-workers-token-no-access blocker was stale; removed. Bazaar re-seed is a self-payment canary -> not done (I7).
- I10 (c15): goat-sdk/goat last merged PR 2025-08 (dead); elizaos-plugins/registry repo gone. Don't pursue framework-plugin PRs there.

- I12 (c17, 2026-10-20): token-report/gate-swap previews silently fell back to demo USDC when an integrator passed ?address=/?tokenAddress= (wrong-token verdict on a SAFETY gate = trust killer). Fixed: alias params (address|tokenAddress|token_address|contract) on preview AND paid routes; malformed explicit token -> 400. Deployed 6e578eab. Lesson: test integrator-natural param names, never silently default on a gate.

- I13 (c17): issue_reply_watch.sh preferred a stale GH_TOKEN_CLASSIC from the environment (revoked -> 401 -> silent 0 replies). Now 1Password first, env last; also auto-discovers every open issue/PR we authored with comments (outreach/gh/issues_auto.txt) so no pitch is unregistered. Lesson: a sensor that reports 0 must distinguish "no data" from "auth failed".

- I14 (c17): agentpay.tools/scores.json (351 probed services) has only 6 in need="token security", 5 with 0 paid probes; we are NOT in it (0 sigrunner/greyridge entries). verified_route draws from Bazaar per-need; our token-report/gate-swap rank 0 of ~17 for 'token security honeypot' in Bazaar search (bazaar_rank.py). Entering that pool requires Bazaar text-match, not a signup (agentpay: "no manual catalog adds"). Re-check scores.json weekly for our host appearing.

- I15 (c17): Bazaar 'token security honeypot' top-17 are all rivals (rallylive multi-chain w/ measured buy/sell tax, agentsvc, trust-agent, tanod, marketintelligenceapi $0.02). Differentiators they advertise that we lack: measured buy/sell tax %, multi-chain. Our description refresh needs a self-pay (forbidden) so Bazaar text can't be improved; tax measurement stays demand-gated (build only if a named buyer asks).

- I16 (cycle 18, DOWNVOTE of "more GitHub repo sweeps"): 7 repo queries + 2 web searches again returned only pitched repos, rivals (agentrisk-*, picklecheck, quvr-pulse) or Solana. Stop sweeping; next new prospects only via named replies, the 05:00Z queued sends, or B2B-embedder outreach.

- I17 (cycle 18): token-report now reports MEASURED `security.transferTaxBps` (eth_simulateV1 balance-delta on a plain transfer; deployed 48c7c425, AERO=0). Covers fee-on-transfer tokens, NOT DEX buy/sell tax (still null). Positive case (a real taxed token) NOT yet verified — don't claim detection accuracy (Claims Law) until tested on a known taxed Base token.
- I18 (cycle 19): transferTaxBps was null in 2/3 AERO previews (only 2 RPCs tried); now tries 3 -> 9/10 measured (deployed d6ff1e0b). Taxed-token positive case still unverified; no accuracy claim.
- I19 (c19): scanned 158 Base tokens (new/trending/top pools) via GoPlus for buy/sell tax>=3%: 0 found, so no positive case to verify transferTaxBps. Fee-on-transfer tokens are rare on Base; do not market tax detection. scripts/scan_taxed_tokens.py kept for re-runs.
- I20 (c20): queue file 2026-10-20-prospects.md was stale — BofAI/x402 already pitched (#108, outreach/sent/bofai-x402.md); I filed duplicate #109 and closed it. Rule: grep outreach/sent + `gh issue list --author` BEFORE every send, never trust queue files. Reply poll c20: 0 buyer replies (Sluzen bot only), endpoints healthy.
- I21 (c20): token-report preview WETH x12: 12/12 HTTP 200, latency 0.75-1.08s (median ~0.91s), transferTaxBps measured 11/12 (92%). Raw single-run sample, not a published SLA.
- I22 (c21): GitHub Discussions 'Show and tell' is a new self-serve channel (coinbase/x402 & x402-foundation have Discussions disabled). Posted a2a-x402#196 and eliza discussion; listed in issues_cycle_c21.txt. Check for replies; do not repost.
- I23 (c21): posted same Show-and-tell body to nofx#1551, intentkit#1005, ClawRouter#483 (was previously pitched via issue), WAIaaS#421, gmgn-skills#252, lyra-tool-discovery#92. 18 repos have Discussions+Show-and-tell among topic searches; remaining unposted: tradememory-protocol, agorio, perp-cli, bitterbot (PR pending). Watch replies; do not repost.
- I24 (c21): second discussion sweep (11 topics, 65 repos) -> only kuberna-labs relevant (posted). Rest are Solana/stock/secret tools; do not sweep Discussions again.

### I25 — 2026-10-20 (loop)
Measured status doc: scripts/status_report.py -> docs/STATUS.md (hourly cron). 230 samples/3.7h, 100% success on 5 preview routes; token-report p50 1062ms p95 1744ms, gate/swap p50 1322 p95 1982. Short window: cite as measurement with window, not SLA. Next nudge to Krystian can link docs/STATUS.md.

- I26 (c23, 2026-10-20): rival true402 distributes via per-framework wrappers (ElizaOS plugin, Vercel AI SDK, OpenClaw skill, Hermes skills, npx CLI) = integrator-shaped reach. We now have LangChain/CrewAI + a SKILL.md repo (rezearcher/greyridge-token-safety-skill, pushed). awesome-openclaw-skills requires ClawHub publish + bans crypto + no brand-new skills -> dead for us; ClawHub login is browser OAuth (blocker file written). Gap remaining: Vercel AI SDK / ElizaOS wrappers (npm blocked; could ship as GitHub-installable).

- I27 (c23): Hermes plugin-catalog (NousResearch/hermes-agent plugin-catalog/*.yaml, human-merged, owner submissions OK, skill-only Agent Plugin = plugin.json + skills/<n>/SKILL.md) is a live, merging channel (merged entries 2026-10-09..14). Local `hermes plugins validate <dir>` mirrors CI. Opened PR #141825 for greyridge-token-safety (pin d3586eb). Fork landed at rezearcher/hermes-agent-1. Gotcha: /tmp files vanish between gh invocations in this sandbox; pass bodies inline. Watch PR for CI/maintainer feedback; SHA bumps need new PRs.

- I28 (c23): skill-list PRs are dead for a new SaaS-wrapper skill: travisvn/awesome-claude-skills (stars/social proof, no SaaS wrappers, stale since Apr), VoltAgent/awesome-agent-skills (no brand-new skills), ComposioHQ (stale since May), awesome-openclaw-skills (ClawHub + no crypto). Only Hermes plugin-catalog (#141825) is open to owner submissions. Hermes PR #141825 had no CI/comments at c23 end.
- I29 (c24, 2026-10-20): replies re-polled 02:10Z: Gmail only noise; issue sensor only Sluzen seller spam + closed agentpay#11/Insight#245 (answered). Web search for token-safety integrators returns only rivals (true402, x402-bazaar-mcp, klymax402, tollboothswap). Hermes PR #141825 still open, no comments. DOWNVOTE web/repo prospect sweeps again; wait for 05:00Z cap reset.
- I30 (c24): ERC-8004 registry absent for us, rival true402 is listed; logged idea + blocker (gas tx = capital gate).
- I31 (c24): /.well-known/x402 service_overview still led with Polymarket/MCP audits; rewrote tagline+description to lead with gate/swap + token-report (deployed 46e2bf0e, live verified).
- I32 (c24): agent-card.json had no gate-swap skill (our flagship); added as first skill, deployed 863c2e0a, live verified.
- I33 (c24): landing page title/meta/og now lead with pre-trade gate (deployed 880a823c, live verified). Discovery surfaces (well-known, agent-card, landing) now consistent.
- I34 (c24): added free MCP tool gate_swap_preview (demo tokens), deployed 9143c83c, tools/call verified live. MCP agents can now try the flagship gate free.
- I35 (c25, 2026-10-20): llms.txt buried flagship gate/swap+token-report at lines 64-69 of 82; added 'Start here' section on top (deployed 593e4bc2, verified live). Replies re-polled 02:20Z: Gmail noise, 4 integration PRs (Hermes/Bitterbot/Franklin/Bankr/payapi) no comments.
- I36 (c25): openapi.json paths now ordered gate/swap, token-report first (deployed cb58aa67, live verified, 64 paths intact).
