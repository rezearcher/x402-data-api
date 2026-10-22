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

## 6. AutoVideo.v1 teardown — keep the realism, drop the traps

Inspected `rezearcher/AutoVideo.v1` (GitHub, last pushed 2025-06, "AI-driven automated video
generation pipeline"; 132 files / 70 Python; a successor `hermes-serenity` also exists). It
was a real, production-deployed end-to-end engine: topic → story (GPT) → scene-split → Veo
video → concat → **YouTube upload w/ metadata**, on GCP Cloud Run + Vertex, with monitoring,
quota guard, automatic rollback. The realism is real; so are the traps.

**KEEP (the realism / good instincts):**
- **It closed the loop to PUBLISH** — not a demo, it actually shipped videos out the door. Our
  engine must publish, not generate-and-stop.
- **It simplified over time** — the "Veo-Only Pipeline" collapsed separate image/TTS/assembly
  stages into Story→scene-split→Veo→concat→upload (85% smaller, sub-4-min). Fewer bespoke
  stages = right direction.
- **Reusable patterns already there**: `veo_adapter` (adapter/swappable backend), `topic_manager`
  (the idea/topic queue = "feed the environment"), `prompt_cache` + `prompt_enhancer`,
  `quota_guard`, `timing_metrics`. These concepts carry over.

**DROP (the hardcoded/old-model-degradation traps — what Rez flagged):**
- **Self-hosted GPU infrastructure** — Vertex GPU containers, L4/T4, preemptible-GPU manager,
  9-tier multi-region fallback, GPU-quota email templates. This was most of the codebase and
  in 2026 it's *one API call* (fal / Veo / Kling / Runway). We already own a swappable
  `video_gen` provider ABC in `hermes-agent/plugins/video_gen/` (fal/deepinfra/xai/openrouter)
  — ADOPT that, never rebuild the GPU stack.
- **GCP Cloud Run + Vertex + cloudbuild** heavy footprint — our stack is the CF Worker +
  python3; no GCP needed.
- **Per-stage model wiring frozen to 2025 models** (GPT story, early Veo) — this is where the
  dated look comes from. Swappable backends + pinned-version evals fix it.
- **YouTube-narrative centric** — our channels are short-form social + data-report graphics for
  Farcaster/X/dev, not long YouTube stories.
- **Fixed/hardcoded scene assembly** — replace with LLM-authored scene-spec (JSON) rendered by
  composable primitives.

## 7. The 2026 rebuild architecture (how we don't repeat the mistakes)

From the tooling research — the method matters more than any single model:
- **Fixed skeleton, LLM-authored content as DATA.** Stages fixed (ingest → ideate → draft →
  critique → assemble → gate → publish → measure); the LLM emits a schema-validated *scene
  spec*, not a filled hardcoded template. New formats = new spec/primitive, not a rewrite.
- **Render layer: adopt Remotion** (React/TS — matches our stack; has Claude-Code agent skills
  + `@remotion/captions` + whisper.cpp captions). A dated look is fixed by asking the agent to
  redo the composition, not by hand-editing a template. ffmpeg for trivial cuts.
- **Swappable model backends behind one interface**, chosen from config — reuse hermes-agent's
  `video_gen` provider ABC. Voice: ElevenLabs (hero) / Gemini TTS (bulk). Video: fal/Veo/Kling
  via the adapter. **Nightly canary per backend** (the Sora-shutdown lesson: OpenAI killed the
  Videos API in 2026 — never hard-depend on one vendor).
- **Anti-slop (what keeps it from looking like the old output):** proprietary data (our scan
  results) in every piece = strongest lever + our moat; a separate critic/editor pass with a
  rubric (fact-count, 2-sec hook, one claim, banned-phrase + claim-verification); a
  deterministic banned-phrase lint in editable config; a novelty check (embed drafts, reject if
  too close to the last N); and the **human-review gate** before publish (per §2).
- **Anti-decay:** a golden-set eval harness re-run on every model/prompt change (regression
  testing for content); pinned model versions + vendor-deprecation watch; analytics feedback →
  top performers become retrieved few-shot examples.
- **Adopt vs build:** adopt Remotion + agent skills + whisper.cpp + an AI-gateway SDK + our
  existing video_gen ABC. Build only the thin spec-driven orchestrator + critic + lint + eval
  harness + analytics loop (that's the part the faceless-video frameworks — ShortGPT,
  MoneyPrinterTurbo (MIT, study-only), MoneyPrinterV2 (AGPL — do NOT adopt) — don't solve;
  they're stage-layout references, not adopts). Stack stays TS/python3, **no PHP** (standing
  rule), security-reviewed per the Security Officer lens.

**Net:** AutoVideo proved the loop can run end-to-end; we keep that ambition and the
adapter/topic-queue/metrics instincts, and we delete the entire self-hosted-GPU/GCP apparatus
in favor of API backends + Remotion + an eval-gated, critic-passed, human-reviewed, data-rich
content spec. That is the "better tools and methods" answer.

## Honest gaps (flagged by the threads)
No clean 2025-26 first-100-customer dataset for our exact category; crypto/web3 funnel
benchmarks essentially absent; Farcaster 2026 metrics unverified (treat the mini-app as a
probe, weak retention); per-subreddit rules unread; Invariant's growth path inferred. All
benchmark numbers are vendor-blog grade — calibrate against our own first-test funnel, not the
benchmarks.
