# Setup Runbook + First-Customer Gap — Grey Ridge x402

**Status:** PLAN (2026-10-22). Companion to `AUTOMATION_POLICY_AND_BUILD_VS_BUY.md`.
Ordered steps to stand up a trustworthy, security-foundational recurring-revenue surface,
marking exactly what is a **Rez atom** (identity/account/legal — only you can do it) vs.
**LOOP** (the automation builds/runs it). Each step names the docs to read and the security
lens. Security is treated as foundational at every step, per the Security Officer stage.

Legend: **[LOOP]** = automation does it · **[REZ]** = irreducible human/identity atom ·
**[LOOP→REZ]** = loop prepares it to one click for you.

---

## Phase A — Trust foundation (make it LOOK and BE a real vendor) — mostly [LOOP]

A1. **[LOOP] Stripe subscription lifecycle glue** (fixes the silent-30-day-expiry gap).
Handle `invoice.paid` / `customer.subscription.updated|deleted` → re-grant credits on
renewal, revoke on cancel, surface failed-payment (dunning). Sits on the existing signed
webhook.
- Docs: Stripe Billing lifecycle — https://docs.stripe.com/billing/subscriptions/webhooks ;
  event types — https://docs.stripe.com/api/events/types
- Security: webhook signature + replay window already present — extend, don't weaken;
  verify `invoice`/`subscription` events carry the same HMAC check; no credit grant without
  a verified `paid` status (app/web + data security).

A2. **[LOOP] Stripe Customer Portal** (self-service: update card, cancel, invoices).
- Docs: https://docs.stripe.com/customer-management/get-started
- Security: the portal is Stripe-hosted → refund/cancel/policy authority lives in Stripe,
  not in our agent (AI security — the Project Vend lesson: the agent points to policy,
  never invents it).

A3. **[LOOP] Legal/trust pages**: `/privacy`, `/.well-known/security.txt` (Terms already
exists), and a short `/security` page stating what we log, scan-input retention, where keys
are stored.
- Docs: RFC 9116 security.txt — https://securitytxt.org ; Stripe website/activation
  checklist — https://docs.stripe.com/checklist/website
- Security: this *is* the data-security disclosure; keep it TRUE (never claim a SOC2 we
  don't have). security.txt needs a Contact + Expires date, refreshed yearly.

A4. **[LOOP] Public status page** (Better Stack free tier, custom subdomain).
- Docs: https://betterstack.com/docs/uptime/status-pages/
- Security: host it OFF our own infra (a status page on the monitored infra is worthless);
  network/infra lens.

A5. **[LOOP] Transactional email** (Resend) for receipts/key delivery/lifecycle notices.
- Docs: https://resend.com/docs/introduction ; DMARC/SPF/DKIM for the sending domain.
- Security: SPF/DKIM/DMARC on the domain (anti-spoof = trust + deliverability); API key in
  1Password op, never plaintext (secrets management).

A6. **[LOOP] Support surface**: `support@greyridgesignals.ai` role address + a static docs
site (quickstart + error-code list) + an honestly-stated SLA ("reply within 1 business
day"). Automated first-response/triage is the one agent-built piece.
- Security: the triage agent may READ and draft, but cannot PROMISE refunds/policy (AI
  security; bounded like send_guard).

---

## Phase B — Fast distribution probe (cheap, $0, minutes)

B1. **[LOOP→REZ] Farcaster / X seed cast** — the free Base Token Gate mini-app.
Everything is built; the one click is yours (custody key).
- Where: `outreach/blockers/seed-miniapp-farcaster.md` (pre-filled compose links).
- Docs for you: skim the cast copy + the mini-app at the workers.dev URL before posting.
- Security: disclose the account is automated where applicable (CA bot law + platform
  rules); post value, never cold mass-DM (AI/social-conduct lens).

---

## Phase C — AWS Marketplace track (deliberate, 2–6 weeks, run in parallel)

C1. **[REZ] Seller registration** — designate the seller AWS account (cannot be moved
later), accept seller terms, Partner Central profile.
- Docs to read: https://docs.aws.amazon.com/marketplace/latest/userguide/seller-account-registering.html
  and eligibility — https://docs.aws.amazon.com/marketplace/latest/userguide/seller-eligibility.html
- Security: use a dedicated seller-of-record AWS account with MFA + least-privilege IAM;
  don't run the Marketplace integration from a root key (identity/infra lens).

C2. **[REZ] Tax + banking + KYC** — tax interview (W-9/W-8), verified bank (US ACH/USD or
SWIFT/Hyperwallet), KYC if EMEA/UK/Korea. Billing-console address must match the tax doc.
- This is pure identity/financial — only you.

C3. **[LOOP] Build the thin SaaS-Contract integration** (our plumbing already exists):
a `ResolveCustomer` registration endpoint, `GetEntitlements` mapped to our plan + `sk_` key
issuance, and an **EventBridge** rule → handler (NOT SNS — SNS is closed to new sellers;
the AWS Quick Start/tutorials show SNS and are reference-only).
- Docs: contract integration —
  https://docs.aws.amazon.com/marketplace/latest/userguide/saas-integrate-contract.html ;
  EventBridge — https://docs.aws.amazon.com/marketplace/latest/userguide/saas-eventbridge-integration.html ;
  prepare (SNS→EventBridge change) —
  https://docs.aws.amazon.com/marketplace/latest/userguide/saas-prepare.html
- Security: validate the `x-amzn-marketplace-token` server-side; least-privilege IAM for
  the entitlement/EventBridge calls; don't trust buyer-supplied identifiers without
  `ResolveCustomer` (app/web + identity lens).

C4. **[REZ] Submit the listing** (logo, description, EULA, refund policy, pricing =
SaaS Contract one dimension per tier, registration URL) + run a test subscription from an
allowlisted account. Then wait on Seller Operations review (Limited → Public).
- Docs: 5 phases to listing —
  https://aws.amazon.com/blogs/awsmarketplace/5-phases-to-listing-saas-product-in-aws-marketplace ;
  confirm the June-2026 Concurrent Agreements requirement before submit.

---

## What still stands between us and our first LEGITIMATE customers
*(assuming all setup above is done today)*

Setup removes the *plumbing* blockers. What remains is the real, honest list:

1. **DEMAND, not rail.** This has always been the gap (our own sensors: the x402 agent lane
   is a ~$37/day desert, 100+ flat cycles). A built, trustworthy product with zero traffic
   still earns $0. The first customer comes from a *reached, qualified audience*, which is
   exactly what Phase B (Farcaster probe) and Phase C (AWS's own buyer traffic) are for —
   AWS matters precisely because it *brings* a fiat-paying audience; the Farcaster probe
   tests whether we can earn attention for $0.
2. **A human actually paying.** The oracle floor is a confirmed external USDC/fiat transfer
   from a non-self payer above our COGS. Everything short of that (listings, casts, pitches)
   is activity, not progress. No amount of building trips it.
3. **Product-audience fit proof.** We *believe* "GO/HOLD/BLOCK before you ape a Base token"
   (retail) and "is this MCP server safe before I connect an agent" (dev/security buyer) are
   wanted. Neither has a paying data point yet. The first dollar is also the first evidence
   the thesis is real; until then it's a hypothesis.
4. **The listing-review clock (AWS only).** 2–6 weeks of Seller Operations review is latency
   we cannot compress — it runs in the background while Phase B earns (or disproves) the
   fast path.
5. **Trust at the moment of payment.** For a security vendor, a buyer's last question is
   "do I trust *them* with my scan inputs / my card?" Phase A exists to answer that before
   it's asked — but it's a necessary, not sufficient, condition for the first sale.

**Bottom line:** after setup, the single thing between us and the first legitimate customer
is **a reached buyer who has the need and says yes** — i.e. distribution + demand proof, not
more infrastructure. The fast test is the Farcaster probe; the durable channel is AWS's buyer
base. Everything in Phase A makes the "yes" *possible and repeatable*; it does not *produce*
the yes. That is the loop's standing job, and it is why DEMAND — not the rail, not security,
not the trust stack — is the real frontier.
