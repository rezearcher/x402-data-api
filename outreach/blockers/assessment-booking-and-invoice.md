# Blocker: real booking + invoice path for the assessment service

**Status:** non-blocking for the page (it ships + converts via mailto today). This upgrades the conversion step.

## What's live (no Rez needed)
- `/security-assessment` (+ `/assessment`, `/services` redirects) — the boutique MCP/agent/on-chain
  security-assessment service page. Deployed, live-verified (commit b7585c9 / ce1e6bc).
  $7,500–$15,000 fixed-scope assessment + $3,000–$5,000/mo monitoring retainer.
- Intake = a zero-dependency form that composes a scoped email to `contact@greyridgesignals.ai`
  (client-side mailto, nothing stored server-side). Funnel wired from the free scanner, `/pricing`,
  `/llms.txt`, and the sitemap.

## The Rez atom (identity/account — not buildable by the agent)
1. **A booking link** for the scoping call — Cal.com / Google Calendar appointment / Savvycal.
   Drop the URL here and the agent will wire a "Book a scoping call" button on `/security-assessment`
   replacing the mailto as the primary CTA.
2. **A Stripe invoice/payment-link flow** for the engagement fee. Stripe is already the live rail
   ($9.99/mo sub works). For assessments the clean path is a Stripe **Invoice** (send after the
   scoping call fixes scope + price) or a fixed **Payment Link** per tier. This needs Rez's Stripe
   account action to create the product/price objects or enable invoicing — the agent can wire the
   button once the link/price IDs exist.
3. **A monitored inbox** at `contact@greyridgesignals.ai` so intake emails are actually seen.
   (The `gmail-greyridge` MCP is configured but currently failing to connect — CONNECTION_CLOSED —
   so the agent cannot confirm the inbox is live. Rez: confirm the mailbox receives + is watched.)

## Why mailto is fine as the shipped default
Convex-barbell: zero new attack surface, zero server-side PII, zero dependency, reversible. A booking
tool is a conversion optimization, not a prerequisite. The offer is real and reachable now.
