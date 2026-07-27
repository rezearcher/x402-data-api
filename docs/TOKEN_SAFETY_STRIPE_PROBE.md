# Stripe-Billed Token-Safety Probe — Smallest Reversible Test

**Task:** t_aef95830  
**Date:** 2026-07-27  
**Context:** x402-agent-only rail = zero revenue signal in 10d (216 gap assessments at 0). Pivot to dual-rail: keep x402 running (sunk cost) + add Stripe-billed human subscribers.

## Product

**What:** Base-chain token-safety / honeypot scanner — already built, already deployed at `/chain/token-security`. Returns risk_score (0-100), verdict (clear/review/block), flags (proxy, upgradeable, mint/pause/blacklist selectors, owner renounced, transfer simulation pass/fail). The API does real compute: EIP-1967/1822 proxy detection, bytecode selector scanning, live eth_call state-override transfer simulation. Not a thin data wrapper.

**Competitive comps with proven revenue:**
- GoPlus Security (~$4.7M revenue)
- TokenSniffer ($99/mo tier)
- honeypot.is, de.fi

## The Smallest Reversible Probe (3 tiers of effort)

### Tier 1 — Landing page + Payment Link (buildable now, Stripe account req'd)

**What:** A single-product landing page pitching the token-safety scanner, with a "Buy $9.99/mo" button linking to a Stripe Payment Link.

**Buildable now:** The landing page itself. It's a static HTML page that can live on a new route (e.g. `/token-safety/`) or as a separate Cloudflare Pages project. Content: demo the scanner (show a live example), explain what it detects, link to Stripe.

**Blocked on Rez:** Stripe Payment Link creation — needs a Stripe account (t_c5200937). Once created, the link URL is a config var.

**Stripe flow:** Customer clicks → Stripe-hosted checkout → card charged → webhook pings a Worker route → API key generated and returned → customer uses API key on `/chain/token-security?token=<addr>&api_key=<key>`.

**Estimated cost to build:** 0 (Zero additional infra — same Worker, one extra route).

**Time to build:** ~1h (single static page + webhook handler + API key auth middleware).

### Tier 2 — Self-hosted checkout (Stripe Checkout + Worker backend, Stripe account req'd)

**What:** Instead of a static Payment Link, serve a Stripe Checkout Session from the Worker. Gives us branding control, metadata on the customer, and a post-purchase redirect to the API key dashboard.

**Buildable now:** The Worker route (`POST /checkout/create-session`), the success/cancel pages.

**Still blocked on Rez:** Stripe secret key (`sk_live_...`) needed server-side to create Checkout Sessions.

**Difference from Tier 1:** A Payment Link is Stripe-hosted (zero dev). Checkout Sessions are server-created (we control the flow, we get customer metadata, we can redirect to a branded success page with the API key displayed).

### Tier 3 — Full subscription portal (Stripe Billing, Stripe account req'd)

**What:** Monthly subscriptions via Stripe Billing (billing portal, customer management, dunning, receipts). The product tiers:
- **Free tier:** 3 token checks/month + the `/preview` fixed-token endpoint
- **Pro tier ($9.99/mo):** 100 token checks/month
- **Scale tier ($49.99/mo):** Unlimited + batch scanning + webhook alerts

**Not recommended for the probe** — too much build risk, too much upfront before validating demand.

## Recommended: Tier 1 — Payment Link + landing page

This is the true smallest reversible test. It costs ~1h of build time (landing page + webhook handler) and the only external dependency is the Stripe account which is already a blocked card on this board.

### Architecture

```
┌─────────────┐     Stripe-hosted     ┌──────────────────┐
│  Customer    │◄─────────────────────│  Payment Link    │
│  (browser)   │     Payment Link     │  (checkout.stripe)│
│             │─────────────────────►│                   │
│             │  card charged        │                   │
│             │                       └────────┬─────────┘
│             │                                │ webhook
│             │                                ▼
│             │                       ┌──────────────────┐
│             │◄──────────────────────│  CF Worker       │
│             │  API key returned     │  POST /stripe/   │
│             │                       │  webhook         │
│             │                       │                  │
│             │──────────────────────►│  GET /chain/     │
│             │  check token w/ API   │  token-security  │
│             │  key                  │  (?api_key=...)  │
│             │                       └──────────────────┘
```

### Files to create/modify

| File | Change | Buildable now? |
|------|--------|---------------|
| `src/index.ts` | Add `POST /stripe/webhook` endpoint + API-key auth middleware + new landing page route | Mostly (webhook needs Stripe secret blocked, auth middleware is generic) |
| `src/index.ts` | Add `GET /token-safety` — human-facing product landing page | YES |
| `wrangler.toml` | Add `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_KEY`, `STRIPE_PRICE_ID` vars | YES (keys blocked) |
| — | Stripe Payment Link creation in Stripe dashboard | BLOCKED on Rez |

### API key schema

```typescript
interface ApiKeyRecord {
  key: string;          // sk_<random-40-hex>
  stripe_session_id: string;
  customer_email?: string;
  credits_remaining: number;  // 100 for pro tier
  created_at: number;
  expires_at: number;   // monthly renewal
}
```

Storage: KV namespace `API_KEYS` (already available in CF Workers, no additional infra).

### Auth middleware

A Hono middleware checks for `?api_key=` query param on `/chain/token-security`. If present and valid, deduct a credit and pass through to the handler. If absent or invalid, return the existing x402 402 challenge (the existing payment middleware handles this). This way the endpoint works for BOTH rails transparently — x402 for agents, API key for humans.

## What gets built immediately (this card)

1. **Architecture document** (this file) — done
2. **Landing page for `/token-safety`** — human-facing pitch page, self-contained HTML, links to Stripe Payment Link (placeholder URL until key available)
3. **Middleware for API-key auth** — dual-rail gate on `/chain/token-security`: if `api_key` present + valid → bypass x402; else → existing x402 flow
4. **Stripe webhook handler** — `POST /stripe/webhook` receives `checkout.session.completed`, generates API key, stores in KV, returns key + instructions in checkout success redirect
5. **KV namespace configuration** — `API_KEYS` in wrangler.toml (doesn't cost anything unless we write to it)
6. **Pricing configuration** — constants for plan tiers, credits, prices

## What stays blocked on Rez

- Stripe account creation (t_c5200937)
- Stripe Payment Link creation (in Stripe dashboard)
- Stripe API key + webhook secret (Worker secrets)
- Actual payment testing

## Success signal (probe outcome)

**Green:** Within 30 days of Stripe link going live, at least one paying subscriber outside our own wallets/traffic. This validates demand and justifies building Tiers 2/3.

**Red:** Zero subscribers in 30 days. Tear down the landing page, mark the human rail as non-viable, go back to x402-only or a different product entirely. Total sunk cost: ~1-2h of build time + Stripe account creation (which was needed anyway for RapidAPI).
