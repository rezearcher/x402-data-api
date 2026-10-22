# BLOCKER: no fiat rail to collect money from a human audience

**Detected:** 2026-10-21 (margin-thesis review)
**Binding for:** the margin product (buyer-and-reseller: user pays fiat, x402 invisible on the backend).

## Why this is the gate
The whole margin thesis is that a human/prosumer pays us in FIAT for a finished outcome, and we
spend less than that on x402 wholesale on the backend. The spread only becomes real revenue if we
can actually charge the human. Today there is no fiat collection rail wired:
- `STRIPE_API_KEY` / `STRIPE_SECRET_KEY` are not in the environment (checked: both unset).
- We have the `stripe-link-cli` and `stripe-projects` skills available, so the TOOLING exists —
  what's missing is an authorized Stripe account + a key.

The x402 receiving wallet already works for the agent/crypto side; this blocker is specifically the
HUMAN side of the margin product. Everything up to taking fiat (the product, the x402 backend, the
free hook, the audience/distribution work) can be built without it — so the loop should build all of
that and leave only the charge step gated.

## The atom (Rez only — identity/account)
Create/authorize a Grey Ridge Stripe account and provide a key (or a reusable Stripe Payment Link / 
Checkout the loop can point the product at). Options, lightest first:
1. A **Stripe Payment Link** (no code, hosted checkout) for a first paid SKU — fastest to a first
   human dollar; the loop wires the product's "buy" button to it.
2. A **restricted Stripe secret key** (Checkout/PaymentIntents scope) in the loop's env/1Password so
   the product can create charges programmatically.

Until then: the loop builds the product + the x402 backend + proves the audience/channel, and names
this as the one remaining step to a first fiat dollar. Do NOT fake revenue; do NOT route human money
through the x402 crypto wallet as a substitute.

## Also blocking (separate, already filed): github-pat-expired.md
The expired GitHub PAT blocks pushing product code / opening PRs. Both are Rez credential atoms.
