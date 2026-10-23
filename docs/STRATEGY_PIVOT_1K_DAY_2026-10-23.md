# Strategy pivot — the road to $1k/day (2026-10-23)

**Why this doc:** the money loop runs clean (12+ passes, native Hermes cron) but earns $0. Root cause is not execution — it is that the whole system targets a model (x402 micropayment reselling) whose ceiling is ~30× below the $1k/day goal. This memo records the evidence and the candidate shapes. Final pick pending the 2nd research brief (distribution + edge-fit).

## The $1k/day math (computed)

$1,000/day = $30,000/mo = $365,000/yr.

| Model | What $1k/day requires | Feasible |
|---|---|---|
| x402 micro @ $0.008–0.05/call | 20,000–125,000 paid calls/day | ❌ = 3–4% of the ENTIRE x402 network, to us alone |
| SaaS @ $99–299/mo | 100–303 subscribers | ✅ |
| B2B @ $2k–10k/mo | 3–15 contracts | ✅ (close ~3–15 is the work) |
| Service @ $1.2k–8k/mo or $8–50k/project | 1–3 closes/mo | ✅ fastest to cash |

## x402 reality (research brief 2026-10-23, sourced)

- Whole network: **~$28k/day real volume; $793k/mo organic and SHRINKING 32%.** 91 sellers earn anything out of 37,495 wallets; **median seller $0.01/mo**; top-10 wallets = 76%.
- **$1k/day = 3–4% of the entire network.** No verified case of anyone at $30k/mo on pure x402 micropayments.
- Our exact shape (data resale / $0.25 decision layer): small sellers show **$0.004–$3.18 lifetime**, single-digit external buyers, ~zero repeat. The only repeat payers anywhere are monitors/auditors.
- Our data (DeFi/token-safety) has **free substitutes** (GoPlus). MCP-injection-scan has a **free open-source incumbent** (MCP-Scan → acquired by Snyk).
- Security buyers = enterprise security teams buying via a **sales motion**, not per-call agent wallets. Autonomous agent-wallets-paying-per-call is still **hype**; humans pay **subscriptions/prepaid**. Real recurring agent spend today = LLM tokens + metered search/scrape (Exa/Tavily/Firecrawl, monthly).
- Sources: x402stats.io via dev.to (91/37,495), Chainalysis, Coinbase, Paragraph ($28k/day), Molt ecosystem audit, Cobo (Stripe MPP), MCPize/MCP-Marketplace (MCP monetization), Indie Hackers (Zigpoll $125k MRR, Post Bridge $35k MRR), AppSecSanta (MCP-Scan→Snyk).

**Verdict:** x402 micro-reselling is a dead end as a $1k/day path. Keep it only as a $0-cost listing/feeder pointing at a subscription.

## The three proven shapes (tiny-team $30k/mo, evidence-backed)

1. **Productized security/agent-build SERVICE (B2B)** — $1.2k–8k/mo or $8–50k/project; 1–3 closes/mo = $1k/day. Fastest to cash; fits Grey Ridge brand + bug-bounty/pentest/DeFi edge + the enterprise-sales reality. Doubles as proof + first customers for a product. **← current lead (beachhead).**
2. **Dev/B2B SUBSCRIPTION product** — $29–299/mo (100–300 customers) or $500–2k/mo (15–60 contracts), free-tier funnel. The durable $1k/day engine, built FROM what shape 1 proves people pay for.
3. **Vertical micro-SaaS for one niche community** — where verified solo $35k–125k MRR cases sit; slower (6–18 mo).

Common thread across every verified winner: **monthly recurring, sold to a reachable human/business — not per-call to agent wallets.**

## CONVERGENCE (both independent research briefs, 2026-10-23)

Two agents, different prompts, same verdict:
- x402 micro-reselling = dead end (feeder/credibility only). Confirmed twice with numbers.
- The money is a **boutique security SERVICE** on our real edge — NOT a per-call API, NOT a self-serve scanner (free incumbents: MCP-Scan→Snyk, Invariant→Snyk, Lakera→Check Point $201M). The scanner is cheap *delivery infra*, not the product.
- Real funded demand, enterprise quote-based buyers: Horizon3 >$100M ARR / 7,000 customers; XBOW $120M raised; Runlayer (Gusto, dbt, Instacart); Zenity $125M Series C. A solo wins as a **specialist assessor**, not a platform.
- $1k/day is a top-decile outcome (Stripe: top-to-median 61×); services are the ONLY shape whose arithmetic reaches $1k/day in ~90 days.

## COMMITTED PLAN (corrected 2026-10-23 — the engine must run WITHOUT Rez)

Binding constraint (PRIME DIRECTIVE, the one I violated in the first draft): income without Rez's time. A human-sold/human-delivered assessment service is a JOB and is REJECTED as the engine. The engine is a **self-serve, automated-delivery monitoring PRODUCT**; the human assessment is an optional upsell only, never the thing that must run.

**THE ENGINE — self-serve agent/MCP security monitoring SaaS.**
- Acquire (marketing/SEO, automated) → self-verify asset ownership (customer's own DNS TXT/file/meta, auto-checked via our DoH `/dns`; no human) → **self-checkout on Stripe (already wired: `src/index.ts` STRIPE_PRICE_ID + checkout→key redemption + webhook)** → automated scan + continuous monitoring + report (all code). ZERO Grey Ridge human in acquire→convert→deliver→bill. Only one-time Rez touch = Stripe payout account (already armed).
- Price to reach $1k/day: $29–99/mo × ~300–1,000, OR add a $299–999/mo team tier × tens. (Micro-reselling stays dead; x402 is a feeder only.)

**THE VALUE LADDER (grounded in the real `/scan/mcp` capability — findings + severity + verdict, OWASP LLM01/LLM08):**
- **FREE (teaser, one-off):** verdict (clear/review/block) + issue COUNTS by severity ("3 high, 5 medium") + categories hit. Answers "do I have a problem?" No detail, no history, no monitoring.
- **PAID (self-serve subscription):** full finding DETAILS + exact locations + REMEDIATION steps; the full/deep check suite; **CONTINUOUS re-scanning on a schedule with drift / new-issue ALERTS** (the only thing research shows people repeat-pay for → the recurring-revenue hook); multiple assets; an auto-generated **compliance/evidence report** (auditor-ready); **CI/API integration** (scan-in-pipeline, fail-the-build, status badge).
- Line: free = IF you're exposed; paid = WHAT, WHERE, how to fix it, and keeps watching + proves it.

**Optional upsell (NOT the engine):** a high-ticket human assessment ($7.5–15k) for teams that ask — Grey Ridge brand, uses the same tooling. Pure upside; the SaaS pays the bills whether or not any human deal ever closes.

**Distribution (automated, no cold human sales):** SEO trust pages (the `/scan/*` census/directory surface already exists), the free scan as the top-of-funnel, owned-content → self-serve signup. The marketing agent drives self-serve signups, not sales calls.

## AUTHORIZATION (decided + codified — NOT a placeholder)

Rez chose "own + opt-in." That was under-specified, so it's now codified to the real industry standard in **docs/AUTHORIZATION_STANDARD.md** (binding). Two tiers:
- **Tier 1 (free self-serve scan):** VERIFIED OWNERSHIP before any active scan (DNS TXT / file / meta / domain-email; manual-review fallback), per-scan attestation, AUP (authorization current + signed by someone with authority + scoped), recordkeeping ≥12mo, user indemnity; passive-only until verified. Matches Probely/Astra/Barracuda/Indusface/Detectify.
- **Tier 2 (paid assessment):** RoE + signed authorization letter + SOW + MSA + NDA, precise scope + explicit "do not test," separate permission for third-party cloud/SaaS; aligned to NIST SP 800-115 / OWASP WSTG / PTES; CFAA/CMA-aware; legal review before signature.
- Prospecting = PUBLIC signals only; never an unauthorized scan to make a lead. Marketing publishes aggregate/anonymized authorized-scan stats only.
All three loop agent prompts are bound to AUTHORIZATION_STANDARD.md.

## NEXT

- DECISION NEEDED (Rez aims): confirm Shape #1 as the direction + the authorization posture above.
- THEN: rebuild the loop's agent prompts (`~/.claude/agent-chains/money/{research,builder,marketing}.goal`) to target the assessment service — research=find reachable authorized buyers + their stacks; builder=produce the findings-report asset + the delivery tooling; marketing=the outreach to named security leads — instead of the micro-reselling thesis.
