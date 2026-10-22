# Marketing Research & Campaign — Grey Ridge x402

**Status:** RESEARCH COMPLETE (2026-10-22). Goal: draw customers (first ~100 paying) on a
guerrilla, near-zero-spend basis. Research-only — nothing launched. Synthesizes three web
threads (AI-persona, channels, funnel-math + guerrilla) against our own hard-won
distribution data. Companion to `AUTOMATION_POLICY_AND_BUILD_VS_BUY.md` and
`SETUP_RUNBOOK_AND_FIRST_CUSTOMER_GAP.md`.

---

## 0. The spine (our validated filter — overrides generic advice)

From `finding_winner_shape_vertical_smb_backoffice_agent` + our own 0/29, <1%-reply lane:
- **Only validated channel: free-tool → community → inbound flywheel** (HIBP / Shodan /
  ProjectDiscovery). Give away something genuinely useful; it earns inbound; a fraction pays.
- **Cold outreach is DEAD for us** — our actual result <1% reply, ~0.2%-to-deal. (Note: the
  funnel-math thread's generic benchmark says cold email ~5% reply and ranked a "qualified
  cold list" as the #1 engine. **We override that with our own data** — cold is not our
  engine. Generic ≠ our segment/execution.)
- **The flywheel only fires in a community the operator already stands in** → security,
  AI-builders, crypto. Both our audiences sit there. Rez's authentic presence is the asset
  ("I am the product / n-of-1→n").
- **We already built the free tools** — the Base Token Gate (`/miniapp`,
  `/gate/swap/preview`), the MCP Security Directory (`/scan/directory`), the badge generator
  (`/scan/badge-gen`), census. Campaign = DISTRIBUTE these, don't build new ones.

---

## 1. The funnel math — is "10k people → 100 customers" right?

**Mostly no — it's the optimistic ceiling, true only for warm, pre-qualified traffic at the
top of the dev-tool conversion range.** End-to-end, 100 from 10k = a 1% rate, which needs
~10% visitor→signup AND ~10% signup→paid. Benchmarks (vendor blogs, cited in the thread):
visitor→trial ~7–10% (dev tools ~10%), free→paid median ~8% but bimodal (dev-tools ~5%),
organic social link CTR ~0.3–1.5%.

Computed reach needed for **100 paying**:

| Scenario (visitor→signup × signup→paid) | Visitors needed | ~Impressions @0.8% CTR |
|---|---|---|
| Optimistic 10%×8% (warm, dev-tool) | ~12,500 | ~1.6M |
| **Base 4%×4% (mixed)** | **~62,500** | **~7.8M** |
| Pessimistic 2%×1.5% (cold, broad) | ~333,000 | ~42M |

And what 10k *visitors* actually yields: optimistic **80**, base **16**, pessimistic **3**.
10k *impressions* yields ≈0. **Takeaway: audience QUALITY dominates; reach sets how long the
hunt takes.** A solo/automated operator cannot hand-reach 60k qualified people, and cold is
dead for us — so the only way to hit that scale on ~$0 is to **borrow distribution** (embed
into surfaces that already have the traffic) and let a free tool + viral loop compound. This
is the hinge of the whole plan.

---

## 2. AI as a marketing persona — VERDICT: (b) engine, not face

Use AI as the **behind-the-scenes content engine** with a **real Grey Ridge / Rez byline**, a
one-line matter-of-fact disclosure, and a **human-review gate on every factual claim**. Do
NOT build an AI persona as the public face.

Why decisive for us: our buyers (traders, security teams) buy on **accountability** — a named
party behind the data. AI-persona wins (Truth Terminal, aixbt → ~300k followers) come from
*entertainment / speculative-token* niches, never from *selling trust*. A synthetic face adds
legal exposure (CA SB 1001 commercial-bot prong, FTC fake-testimonial rule, EU AI Act Art.50)
for no demonstrated upside, and for a security product one invented claim ("this token is
safe") costs more than a quiet week. Surveys: ~90% want AI disclosed; ~47% of B2B buyers
trust AI-generated resources less. Shape:
1. Byline = Rez / Grey Ridge (real founder, real findings).
2. AI drafts at volume from scanner/API output (reports, threat notes, charts).
3. **Human-review gate**: every claim traced to scan data before it posts.
4. One-line disclosure in bio ("Research by Grey Ridge; drafts AI-assisted, reviewed &
   published by Rez"); turn on X's Automated label for any API-scheduled feed.
5. Make AI a *proof point* via demonstrable output ("our scanner is agent-built, here's the
   evidence") — never an "AI replaced people" boast.
6. A SEPARATE, clearly-labeled pure-data feed (e.g. "new risky Base tokens flagged") may be
   fully automated — nobody mistakes a data feed for a person. Keep it distinct from the
   human-voice channel.
Hard don'ts: no fake testimonials, no AI DMs posing as human, no token-shill persona, no
unreviewed autoposting of claims about specific tokens/servers.

---

## 3. What marketing means in our space + channel bets

**The pattern that works in our niche is "be the check INSIDE other products," not "be a
destination."** Strongest sourced signal: rug-check tools grow by embedding — RugCheck ~10M
checks/mo, Fluxbot built into it; GoPlus is the backend for many scanners; Token Sniffer
sells its API to DEXs/bots. Embedding *borrows* the traffic §1 says we can't generate alone.

| Audience | Highest-ROI low-spend tactics | First bet |
|---|---|---|
| **Base retail traders** | Embed the gate/API in existing Telegram trading bots & wallets · same-day newsjacking of rugs/exploits · shareable verdict card/badge · Farcaster mini-app + notifications (probe, weak retention) · seed 5–10 micro-KOLs with free API | **Embed the gate into existing token-bot ecosystems**, with automated same-day posts as the content layer |
| **MCP / agent devs + security teams** | Claim the registry listings (official MCP Registry + Smithery/Glama/PulseMCP) · free scanner + GitHub Action · "we scanned the top N servers" data report (w/ responsible disclosure) · one-shot Show HN / r/mcp timed to the report · comparison pages (vs mcp-scan / Snyk) | **Registry listings first** (hours of work, where installers look), **then the scan report** as the credibility engine |

Precedent: Invariant Labs named "tool poisoning," shipped a free scanner, got acquired by
Snyk (2025-06). Naming the attack class + a free scanner + a data report is the proven devtool
security play. Content cadence realistic for one operator: ~1 data report/month (anchor),
weekly incident teardown (agent-drafted, Rez-reviewed), daily automated token-safety feed,
always-on programmatic pages. **Lead with research, not features** (precision/false-positive
numbers are themselves credible content).

---

## 4. THE CAMPAIGN — "The Grey Ridge Safety Check, everywhere"

Guerrilla by construction (borrows distribution, free tool as the lead magnet, earned
attention, viral loop — zero ad spend):

1. **Lead magnet (built):** the free verdict — GO/HOLD/BLOCK for Base tokens, a safety
   grade + badge for MCP servers. Free tier, no login.
2. **Borrow distribution (the unlock):** get the free check *inside* surfaces that already
   have traffic — Telegram trading bots / wallets (crypto), the MCP registries + a GitHub
   Action (dev). This is how we reach §1's tens-of-thousands without owning an audience.
3. **Viral loop (built):** every verdict is a shareable card / embeddable "checked by Grey
   Ridge" badge with a link back — each embed is a backlink + an ad.
4. **Earned-attention engine (monthly):** a proprietary data report — "we scanned the top N
   MCP servers / N new Base tokens, here's what's unsafe" — as the credibility anchor + the
   Show HN / Reddit / PR spike, plus same-day newsjacking when a rug/exploit hits.
5. **Voice:** Grey Ridge / Rez byline, AI-drafted + human-reviewed, disclosed (per §2).
6. **Funnel instrumentation:** UTM + `?ref=` (already live) on every link; measure
   reach→visit→free→paid and feed what converts back in. Validate against the §1 base case
   (expect ~60k qualified visits per 100 payers) before scaling any one channel.

**Cheapest first test** (to calibrate our real rates before scaling): ship the GitHub Action +
claim the registry listings + publish ONE scan-of-top-N report timed to a Show HN. Measure the
actual funnel. That's a few days of the loop's work, ~$0, and tells us which scenario row we're
really on.

---

## 5. Should this be an agent? — YES (later; a capped content/distribution engine)

The `IDEAS.md` "automated content/PR engine" is the right shape: idea-gen (mines the
environment — new rugs, CVEs, scan results) → writer (Grey Ridge voice, UTM links) → **human-
review gate** → poster (X Automated-labeled / Farcaster / Bluesky) → analytics → feeds idea-gen.
Constraints (standing): disclose automation, no slop, no fabricated news, Grey Ridge byline,
human-review gate on claims. Architecture: its OWN capped driver (per kairos template), **not a
makemoney-loop sub-agent fan-out** (the loop doesn't spawn agents). Decide/build AFTER the
cheap first test (§4) proves a channel — don't build the amplifier before we know what to
amplify. Human atom = Rez authorizes the account(s) + grants API access.

---

## Honest gaps (flagged by the threads)
No clean 2025-26 first-100-customer dataset for our exact category; crypto/web3 funnel
benchmarks essentially absent; Farcaster 2026 metrics unverified (treat the mini-app as a
probe, weak retention); per-subreddit rules unread; Invariant's growth path inferred. All
benchmark numbers are vendor-blog grade — calibrate against our own first-test funnel, not the
benchmarks.
