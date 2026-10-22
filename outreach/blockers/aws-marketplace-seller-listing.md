# Blocker — list Grey Ridge on AWS Marketplace (proven-fiat-WTP channel)

**Why this, why now.** After 48 flat cycles the data is unambiguous: the x402 agent
rail is dust (3 one-shot bot payers, $0.022/30d, zero repeat — verified live from the
worker `/metrics` `net_external` block on 2026-10-22), and consumer token-safety is a
free commodity (~0 willingness-to-pay). Every zero-Rez channel we hold reaches either
non-converting agent-devs or an audience with no proven budget.

AWS Marketplace is the opposite: a channel whose audience **demonstrably pays fiat,
monthly, for security/compliance artifacts.** Direct precedent in our own winner
registry — **Secreply sells a compliance artifact there at $226/mo.** MCPSafe charges
$19–149/mo off-marketplace; the market floor for this product class is real and nowhere
near our $9.99/mo. Our MCP tool-poisoning / prompt-injection scanner + token-safety /
tech-risk API is exactly the product class AWS enterprise security buyers already buy —
and the 2026 marketplace landscape shows **none of the major MCP marketplaces offer a
third-party security audit** (gap, not a crowd).

This is the "better-qualified prospect" the goal-gate keeps asking for: a buyer with
budget and acute need, reached through a self-serve listing instead of a cold pitch.

## Convex-barbell check (passes)
- **Downside:** bounded and recoverable — one-time registration time + AWS's revenue
  share on sales (no listing fee for SaaS/API products; ~3% on private offers, higher on
  public). **No capital at risk.** If it converts zero, we've lost only setup time.
- **Upside:** uncapped recurring enterprise subscriptions at the $200+/mo tier the
  precedent proves. Asymmetric.
- This is an **identity/account-setup atom** (same class as `npm login`), **not a
  capital-deployment gate.** It does not require deploying real money.

## The atom — one-time Rez setup (everything else is automatable afterward)
Registration now runs through **AWS Partner Central** (AWS updated the flow in 2026;
older guides describe the AMMP console — use Partner Central). Exact requirements:

1. **AWS account** for the seller (can be a dedicated one for Grey Ridge Signals Group LLC).
2. **Business + identity verification** in Partner Central (KYC). Legal entity must be
   **Grey Ridge Signals Group LLC**.
3. **Tax form:** W-9 (US entity). The business location must **match** across the AWS
   Billing console and the tax submission before any paid product can publish.
4. **Bank account** that can accept USD disbursements, tied to the same legal entity;
   must be verified before disbursements.
5. Complete the **public seller profile**.

Hand the loop back: once the seller account exists and is verified, the product listing
itself (SaaS contract / API product, pricing dimensions, the free-preview → paid tiers,
the metering wiring to our existing Stripe + x402 backend) is **buildable with no further
Rez action** — the loop can draft the listing, the CloudFormation/API fulfillment, and
the pricing page from the existing product.

## What the loop does without waiting on this
- Pre-build the listing collateral (product description, categories, pricing dimensions,
  the fulfillment URL, the comparison-to-MCPSafe one-pager) so the moment the seller
  account is live, publishing is minutes not days.
- Keep the research-queue item (`a51db25871`) warm: validate the exact Partner Central
  current screens and whether an API-product listing (vs SaaS-contract) avoids the
  heaviest KYC.

## Sources
- AWS official seller guide + registration-process docs (Partner Central flow, W-9/W-8,
  USD bank account, business-location match).
- Clazar / SaaSify third-party AWS Marketplace onboarding guides.
- Winner registry: Secreply — compliance artifact, $226/mo, AWS Marketplace.
- Live worker `/metrics` 2026-10-22: `net_external` = 3 one-shot payers, $0.022/30d.
