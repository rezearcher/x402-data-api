# Grey Ridge x402 — Operating Plan (the loop runs BOTH lines; the thinking is DONE here)

Decision (Rez, 2026-10-23, final): the money loop is the autonomous OPERATOR of one business, `x402-data-api`, with **two revenue lines**, and it grows **both** at a professional level. This plan SOLVES the how — specific buyer, specific funnel, move-by-move path to the first *repeat* dollar per line. The loop executes this backlog top-down; it does not re-invent strategy at runtime. Reads with [[NORTH_STAR]], SCOPE_AND_REPORT_STANDARD, AUTHORIZATION_STANDARD.

Ground truth today (measured): total external revenue EVER = **$0.77** (364 external txs, 3 wallets) on Line A; Line B = $0. So the honest job is getting the FIRST REPEAT DOLLAR on each line, then compounding. Not $1k/day today — the first repeatable dollar, then scale what repeats.

---

## LINE A — x402 pay-per-call safety rail for autonomous trading agents

**Who pays and why:** autonomous trading agents on Base (and the devs running them) call our pre-trade safety gate (`/gate/swap`, `/chain/token-report`, `/chain/token-security`) because a honeypot/rug costs them real funds; our check is $0.008–0.01 vs rivals up to $0.25, Base-native, honeypot+sizing in one call. They pay per trade-decision, forever, if it's wired into their agent.

**The distribution multiplier (the actual how):** a trading agent doesn't "discover an API" — it runs a FRAMEWORK, and installs TOOLS/PLUGINS. So we win by being the default pre-trade-safety tool INSIDE the frameworks. We already have example integrations (`docs/examples/elizaos`, `langchain`, `vercel-ai-sdk`, `swap-gate`). The plugin is the funnel: install once → every trade the agent makes pays us.

**Path to first REPEAT dollar (ordered):**
- A0. Reliability gate: the 3 current payers churn if the paid routes ever drop or mis-verdict. Add uptime+correctness monitoring on `/gate/swap` & token routes; alert on any 5xx or verdict-sanity failure. (A dropped gate = a lost customer.)
- A1. Ship ONE real, installable plugin to completion — ElizaOS first (we have the example), wrapping `/gate/swap` as a "pre-trade safety" action with our x402 payment inline. Publish it to the ElizaOS plugin registry with copy that leads with the wedge (honeypot+sizing, Base-native, 1/25th the price).
- A2. List the route in the catalogs agents actually browse (CDP Bazaar, Circle marketplace) ranked for "pre-trade token safety / honeypot gate."
- A3. Repeat dollar = one installed agent that trades repeatedly. Measure per-route wallet inflows; when a non-self wallet pays >1×, that's the milestone.
**Compounding:** add the second framework (Vercel AI SDK tool, then LangChain); add higher-value routes (sizing, exit/entry sim) to the plugin so $/payer rises.

## LINE B — security trust-badge + continuous monitoring for MCP servers

**The honest problem (don't skip it):** one-off MCP scanning is a FREE commodity (Snyk owns mcp-scan). Nobody self-serve-pays for a one-off scan. So we do NOT sell "a scan." Enterprises buy Snyk through sales; we can't win there as a solo.

**The wedge that a self-serve buyer actually pays for:** people who PUBLISH an MCP server want their users to TRUST it — that's a *marketing* incentive, not just security. So we sell a **public trust badge + continuous monitoring**: a free scan issues an embeddable "MCP security: verified" badge (re-checked periodically); to keep the badge live/green, get drift alerts, and get the full auditor-ready report, they subscribe ($9.99+/mo, Stripe rail already wired). The badge is BOTH the product AND our distribution — every embedded badge on someone else's MCP server markets us. We already have `/scan/badge-gen`, `/scan/directory`, `/scan/census`.

**Who pays:** MCP-server authors who want adoption — indie/small AI-tool builders and crypto/DeFi MCP providers (our DeFi edge), i.e. the long tail Snyk's enterprise motion ignores. They pay self-serve because the badge sells THEIR tool.

**Path to first REPEAT dollar (ordered):**
- B0. Credibility: finish the self-assessment of OUR OWN stack to the competitor-grade report standard (headers already fixed, commit 9f98484) — the reference report + proof we practice it.
- B1. Ship the loop: free scan (automated DNS-challenge verify, no human) → verdict + embeddable badge → Stripe subscription to keep the badge live + alerts + full report. Honest scope on every surface ("static LLM01/LLM08 detection + monitoring," never "safe"/"pentest").
- B2. Seed the funnel: the SEO/census/directory surface ranks for "<server> MCP security"; each scanned server gets a badge offer.
- B3. Repeat dollar = one MCP author who subscribes to keep their badge live. Measure Stripe settled subscriptions.
**Compounding:** CI/API integration (fail-the-build badge) makes it sticky; the directory grows and every badge is a billboard.

---

## THE LOOP (how it operates both, at a high level)

One engine (`agent_chain.sh`, Hermes native cron, Claude). The thinking is in THIS plan, so the loop executes a backlog, it does not improvise strategy:
- **Research/GM (each pass):** read the revenue oracle; take the TOP uncompleted move from the A/B backlog above (ordered; A0/B0 before A1/B1…); when both lines have a ready move, pick the one with the higher expected real-$ return this cycle; record it as the pass target. Only add/re-order backlog moves when a move is *done* or the oracle proves one dead.
- **Builder:** ship that move to deployed + live-verified reality (plugin published, badge endpoint live, oracle wired, route fixed). Real diffs only, no self-attestation; deploy via CI push; verify live.
- **Marketing:** drive real customers to whatever's shippable — the plugin listing / catalog (A), the free-scan→badge funnel + SEO (B). Owned `site` always available.

## MEASUREMENT — real dollars, per line (Phase 0, build FIRST)

Wire one revenue oracle the loop reads for completion/kill:
- Line A: non-self wallet inflows per route (revenue sensor `~/.hermes/data/x402-revenue/latest.json`).
- Line B: Stripe settled subscriptions (webhook → a revenue record).
Success = real external $ growing, per line. Kill/scale on real numbers: scale a move that produced a repeat payer; abandon a specific move (not the business) if it produces $0 after a set number of passes.

## SEQUENCE (critical path)

Phase 0 — instrument: revenue oracle (A+B) + paid-route uptime monitor. Nothing else is trustworthy until the loop measures dollars.
Phase 1 — first repeat dollar, both lines in parallel: A0→A1→A2 and B0→B1→B2.
Phase 2 — compound: second framework + higher-value routes (A); CI + directory growth (B).
Phase 3 — toward $1k/day via the mix, oracle driving allocation.

## STANDING RULES (carried from everything discussed — do not drop)

Autonomous: NO human in the operating loop; handing work to Rez is the forbidden exit. Authorization: own assets + automated DNS-challenge-verified opt-in only (AUTHORIZATION_STANDARD.md); never test an unverified third party. Scope honesty + Claims Law (SCOPE_AND_REPORT_STANDARD.md): sell exactly what we do, "clear" ≠ "safe," every number traced. Competitor-grade quality or it doesn't ship; proven on real targets, never claimed. No PHP. No capital/bounty gates arise in this product.
