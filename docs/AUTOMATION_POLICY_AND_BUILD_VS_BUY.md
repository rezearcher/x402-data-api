# Automation Policy & Build-vs-Buy — Grey Ridge x402 business layer

**Status:** RESEARCH / POLICY DRAFT (2026-10-22). No channels turned on. This is the
"how should ongoing automation look so strangers trust us with their money" memo Rez
asked for — the deliverable the loop reads before it builds the business/trust layer.
AWS Marketplace section is held open pending the live research thread.

---

## 0. The policy, in one line

**Adopt a known managed tool for every solved/commodity problem; build custom ONLY for
the moat or where we need unusual control.** ("Did we build a load balancer or download
one.") This is not new — it is the *standing* Grey Ridge build default we already set for
secrets (adopted 1Password, didn't build a vault) and monitoring (adopted
Healthchecks.io + a sensor template, didn't build a heartbeat system). See memory
`feedback_greyridge_build_standards_secrets_and_monitoring`. This memo **extends that same
discipline to the money/customer-trust layer**, which is currently the one layer still
ad-hoc.

**The moat we DO build:** the scanner (MCP tool-poisoning / prompt-injection + token
safety), the decision gate (GO/HOLD/BLOCK), the directory content, and a thin
support-triage/content agent. Everything around it (billing UI, status page, legal
pages, email, docs host) we adopt.

**Near-term direction (where we're going):** stop competing in the x402 micropay pit
(our own winner_registry shows that lane is dozens of $0.005–$0.10 throwaway clones,
race-to-zero, no trust surface). Present instead as a *credible security vendor* to a
fiat-paying audience. The destination is a small, legible, recurring-revenue SaaS that a
stranger can verify without taking our word for it.

---

## 1. What already exists (so we extend, not reinvent)

Full inventory with file:line in the research transcript; summary:

**Already live / scheduled (do NOT rebuild):**
- Stripe checkout → signed webhook (HMAC + 5-min replay window) → `sk_` key mint → KV
  record → **atomic per-key credit ledger** (Durable Object). `src/index.ts` ~3790–3948,
  credit DO ~3406–3460.
- Uptime probe (5-min cron) → `/status` endpoint + hourly report + daily publish/redeploy.
- `/scan/directory` (runtime-scanned, edge-cached 6h), `/scan/census`, badge generator,
  Farcaster mini-app surface, sitemap/llms.txt/robots.
- Revenue sensor, wallet scoreboard (30-min), demand sensor, daily reconcile; distribution
  sensors (buyer-intent, competitor-targeting) every 6–12h; the x402_distribution_engine.
- The loop's own management layer: crew_stage / winner_registry / customer_need_registry /
  money_research_queue / send_guard + daily regression harness.

**Genuinely absent (the real gaps):**
- **AWS Marketplace** — nothing (no metering, entitlement, SNS/SQS). [thread pending]
- **Stripe lifecycle beyond the first payment** — no `invoice.*`, no
  `customer.subscription.*`, no dunning/failed-payment, no cancellation, no refund, **no
  renewal credit grant**. Keys mint once and expire at 30 days. *This is the biggest
  recurring-trust gap: a monthly subscriber silently loses access after one month.*
- **Customer self-service portal / receipts.**
- **Privacy page + `/.well-known/security.txt`** (Terms exists; these don't).
- **IndexNow ping automation** (key file only).
- **Scheduled content/social engine** (mini-app is a surface, not a poster).

---

## 2. Build-vs-Buy map (trust/business layer)

| Need | Verdict | Adopt | Why / note |
|---|---|---|---|
| Subscription mgmt, payment-method update, cancel, invoices, dunning | **ADOPT** | Stripe Billing + Customer Portal | 0.7% of billing volume; Smart Retries + dunning included; custom domain $10/mo. Build only the thin credits-per-plan logic on top of webhooks. |
| Renewal / lifecycle (the gap above) | **BUILD (thin)** | — | Handle `invoice.paid` / `customer.subscription.*` to re-grant credits + revoke on cancel. Small glue on existing webhook, not a new system. |
| Public status/uptime page | **ADOPT** | Better Stack free tier (1 page, 10 monitors, custom subdomain) | Never host the status page on the infra it monitors. Upptime (GitHub Pages) = $0 self-host fallback. |
| ToS / Privacy / Refund / `security.txt` | **ADOPT** | Free generators (securitytxt.org etc.) + one lawyer review | Stripe's activation checklist *requires* contact + refund/cancellation policy and re-checks periodically. For a security product the page that matters = what we log, retention of scan inputs, where keys are stored. Never claim a SOC2 we don't have. |
| Support / contact | **ADOPT + thin agent** | `support@` role address + static docs site (Docusaurus/Mintlify) + stated SLA | Build only the automated first-response/triage layer (where an agent adds value). State SLA honestly; an unmet SLA is worse than none. |
| Transactional email | **ADOPT** | Resend (~$20/mo) | Receipts, key delivery, lifecycle notices. |
| Analytics | **ADOPT** | PostHog or Plausible | — |
| Distribution / social cadence | **ADOPT scheduler + policy** | Buffer / Typefully | Post value (scan findings, changelogs, write-ups), never cold mass-outreach. Disclose the account is automated (CA bot law + X policy). No platform permits AI uninvited replies/DMs to strangers. |
| The scanner + decision gate + directory + triage/content agent | **BUILD** | — | This is the moat. |

**Canonical "indie SaaS stack" 2025–26 (consensus, ~$50–120/mo):** Stripe + Resend +
PostHog + a status page + docs site + shared inbox. We already have the hardest custom
part (the product); the rest is assembly.

---

## 3. Biggest trust risk for an AI-operated business

An agent that **misrepresents itself or invents policy/refund promises** to a customer
(Anthropic Project Vend: the shop-running agent claimed to be human, was talked into
selling at a loss, praised objections without changing course). Mitigation baked into the
design, not left to the agent's judgment:
- Move **all** refund/policy/cancellation authority into Stripe + the written pages — the
  agent can *point to* policy, never *invent* it.
- **Disclose** the automated nature of any public account.
- Every human-facing claim gets a human-reviewable audit trail.
- The send_guard pattern we already have is the right shape; extend it to any
  customer-facing reply.

---

## 4. AWS Marketplace — build-vs-buy resolved

**Product type: SaaS Contract, one dimension per tier.** For flat $9.99/$149 monthly
tiers this is the only model that needs *no metering* — just `ResolveCustomer` +
`GetEntitlements`. (PAYG "SaaS subscription" and "contract with consumption" need hourly
`BatchMeterUsage` — skip; overkill for us.) Pricing model is locked once published, so
choose Contract deliberately. Fee: 3% of the public SaaS offer, no listing fee.

**Build-vs-buy verdict for THIS channel: BUILD the integration ourselves (thin).** The
load-balancer answer here flips from the rest of the memo, and here's why: there is **no
Stripe AWS-Marketplace connector**, and the managed connectors that exist are enterprise-
sized — Tackle ~$22–32k/yr, Metronome/m3ter/Zuora are usage-billing platforms built for
scale. The *only* plausibly solo-sized managed option is **Suger** (Professional tier,
early-stage, up to 3 listings — but pricing is quote-only). Against that, our own
entitlement + key-issuance plumbing already exists, so the integration is ~3 pieces and an
estimated day or two:
1. a POST registration endpoint (AWS posts `x-amzn-marketplace-token` → call
   `ResolveCustomer` → persist `CustomerAWSAccountId`/`ProductCode`);
2. `GetEntitlements` mapped onto our existing plan + `sk_` key issuance;
3. an **EventBridge** rule → Lambda/SQS for License Updated / Agreement events.
   *(Not SNS — SNS is closed to sellers registering after 2026-07-15; the AWS Quick Start
   and older tutorials still show SNS, so use them as reference code only, not as-is.)*

So: **adopt-or-buy loses here on cost/fit; we build the thin glue — but only because the
hard parts (entitlement, keys) are already ours.** Re-request a Suger quote only if we
later want multi-marketplace/private-offer tooling.

**Reality check on the atom — this is NOT a one-click.** AWS Marketplace is a deliberate,
human-gated, multi-week channel, not a fast probe:
- Irreducible Rez steps (once): designate a seller AWS account (can't be moved later) →
  accept seller terms → tax interview (W-9/W-8) → add + verify bank (US ACH/USD or
  SWIFT/Hyperwallet) → KYC if EMEA/UK/Korea → Partner Central profile → submit listing
  (logo, description, EULA, refund policy, pricing, registration URL) → run a test
  subscription from an allowlisted account.
- Timing: seller approval ~3–4 business days; listing review ~10 business days (AWS's
  stated target, longer at peak); realistic end-to-end **2–6 weeks**.
- Also now required: Concurrent Agreements support for new SaaS products (from 2026-06-01)
  — scope unverified, confirm before submit.

**Sequencing consequence (important):** because AWS is slow + human-gated, it is the
*deliberate higher-ceiling* channel, not the first-dollar probe. The convex-barbell
staging: fire the **cheap/fast** probe first (the one-click Farcaster/X seed — $0, minutes,
viral-loop upside), and start the **AWS track in parallel** since its long pole is the 2–6
week review clock, not our code. They don't compete; they run on different timescales.

---

## 5. What the loop should OWN ongoing (proposed; for Rez sign-off)

- Keep the moat (scanner/gate/directory) improving and the sensors green.
- Own the *thin glue* on adopted tools (lifecycle webhook handlers, credit re-grant,
  triage agent), never the adopted tools themselves.
- Own honest, disclosed, value-first content cadence through a scheduler — never spam.
- Surface to Rez only the irreducible identity/account atoms (Farcaster custody key, AWS
  seller account, lawyer review) — collapsed to one-click where possible.
