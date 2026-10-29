# Accounts & Credentials Plan — Grey Ridge (worked backwards from the paradigm)

**Status:** PLAN (2026-10-22). Derived backwards from the marketing-director agent +
campaign (`MARKETING_RESEARCH_AND_CAMPAIGN.md`) + trust stack
(`AUTOMATION_POLICY_AND_BUILD_VS_BUY.md`) + AWS track (`SETUP_RUNBOOK…`). Almost every account
is a **Rez atom** (identity/financial — only you can create it); the goal is the COMPLETE set
so nothing surprises us, then a staging so you provision the **minimum first** and never
over-provision. Once an account exists, the automation does the rest (store the cred in
1Password, wire the agent, add DNS records, claim listings).

## Standing rules for EVERY account (Security Officer lens)
- Unique strong password in **1Password** (Division vault) + **MFA/TOTP** (seed stored
  in 1Password; a hardware key for the money/identity ones: domain, AWS, Stripe, GitHub, email).
- API credentials: **least-privilege scope** (posting-only, not account-admin), short-lived
  where offered, stored as `op://` refs — never plaintext, never in a client/edge response or
  log. Rotate.
- **Register everything under the Grey Ridge email, NOT Rez's personal Gmail** — so accounts
  are company-owned, transferable, and a compromise of a personal inbox doesn't cascade.
- Each public account is both an attack surface AND a brand asset (a hijacked social handle
  posts malicious links under our name) → MFA is non-negotiable there.
- Disclose automation where a feed is automated (CA bot law + X/platform rules); human-voice
  accounts carry the Grey Ridge/Rez byline (persona verdict §2).
- **No PHP** anywhere in any adopted tool (standing rule).

---

## TIER 0 — FOUNDATION (the identity anchor; everything hangs off it) — do FIRST
| Account | Have? | Free/paid | Rez atom? |
|---|---|---|---|
| `greyridgesignals.ai` domain | **HAVE** (on our Cloudflare) | — | — |
| Cloudflare | **HAVE** | — | — |
| 1Password Division vault | **HAVE** | — | — |
| **Grey Ridge email on the domain** (e.g. `hello@` / `support@` / `press@`) | **NEED** | free→$6/mo | **YES (atom #1)** |

Email recommendation: start with **Cloudflare Email Routing** (free, we already own the zone —
receive + forward) and **send** via Resend (Tier 2). Upgrade to Google Workspace (~$6/mo) only
if you want a real human send-from inbox. This address is THE anchor you use to sign up for
everything below.

## TIER 1 — FIRST-TEST ONLY (the §4 cheap proof: dev lead-magnet + scan report) — provision only these to start
| Account | Have? | Free/paid | Rez atom? | For |
|---|---|---|---|---|
| GitHub (valid token) | identity HAVE; **token NEED-refresh** | free | **YES (atom #2 — known blocker)** | publish the GitHub Action + scanner repo; the official MCP Registry publishes via GitHub |
| Smithery / Glama / PulseMCP listings | **NEED claim** | free | small (one-time claim) | MCP registry discovery (where installers look) |
| Hacker News account | NEED/confirm | free | YES (quick) | the Show HN of the scan-of-top-N report |
| Reddit account (aged helps) | NEED/confirm | free | YES (quick) | r/mcp, r/LocalLLaMA post |

No paid spend, no social-posting API yet. This tier tests whether the dev channel converts.

## TIER 2 — CHANNEL-PROVEN (after the first-test; the marketing-director's publishing surfaces)
| Account | Free/paid | Rez atom? | Note |
|---|---|---|---|
| **Bluesky** + app password | free | YES | cheapest/most-open posting API — the FIRST social |
| **Farcaster/Warpcast** + Neynar API key | free tier | **YES (custody key)** | activates the mini-app we already built |
| X/Twitter + Developer app | **paid/gated** | YES | only if X proves worth the API cost; turn on the Automated label |
| Telegram (BotFather token) | free | YES (quick) | only if we pursue bot-embedding partnerships (the crypto unlock) |
| Gemini API key | cheap | YES | bulk TTS + images (Nano Banana) — capped |
| ElevenLabs | paid, capped | YES | hero voice only (barbell) |
| fal.ai (or reuse hermes video_gen) | paid, capped | YES | hero video only, latest — add last |
| Resend + domain DKIM/SPF/DMARC | free tier | YES (acct); DNS = automatable | receipts/lifecycle email + deliverability |
| Better Stack (status page) | free | YES (quick) | API trust signal |
| PostHog or Plausible | free/cheap | YES (quick) | funnel analytics (feeds the agent's "what converted") |

## TIER 3 — AWS / FIAT TRACK (parallel, slow ~2–6wk; the durable revenue channel)
| Account | Free/paid | Rez atom? |
|---|---|---|
| AWS seller account (dedicated seller-of-record) + tax interview + bank + KYC | free to list; 3% fee | **YES — the big identity/financial atom** |
| Stripe | **HAVE** (armed) | — |

---

## The Rez-atom list, minimal and in order (this is the whole "what only you can do")
1. **Grey Ridge email** on `greyridgesignals.ai` (CF Email Routing, free) — the anchor.
2. **Refresh the GitHub token** (unblocks push + Action publish — already pending).
3. **HN + Reddit accounts** (or confirm yours) — register under the Grey Ridge email.
   → With 1–3 done, the loop can run the entire §4 first-test. STOP here until it proves a channel.
4. (only when a channel proves) **Bluesky** app password · **Farcaster custody key** + Neynar ·
   then X/Telegram/paid-gen keys as each earns its cost.
5. (parallel, start anytime) **AWS seller account** + tax/bank/KYC.

Everything else — storing creds in 1Password, wiring the `marketing-director` agent, adding
DKIM/SPF/DMARC records, claiming registry listings, enabling automation labels — the automation
does once the account exists. You create the identity; we do the plumbing.
