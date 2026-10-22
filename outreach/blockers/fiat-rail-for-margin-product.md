# BLOCKER: fiat rail — one atom left (Stripe secret key)

**Updated:** 2026-10-22 (deploy rail confirmed alive; atom shrunk to the Stripe key)
**Binding for:** the margin product (human pays fiat, x402 invisible on the backend).

## Status: everything is wired and waiting — only the Stripe key is missing
The deployed Worker ALREADY has the full Stripe flow live:
`POST /stripe/create-checkout-session`, `POST /stripe/webhook`, and the `/api-key?session_id=`
redemption page. Right now the endpoint returns `{"error":"Stripe not configured"}` because the
three Worker secrets (`STRIPE_API_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`) are not set.

**The loop can set all three itself** — the Cloudflare deploy rail is alive via
`CLOUDFLARE_API_TOKEN` read from `op://Division/CF_WORKERS_TOKEN` (verified 2026-10-22:
`wrangler secret list`/`deploy` both work; the dead rail was only wrangler's interactive OAuth).
So the ONLY thing the loop cannot produce is the Stripe secret key itself — that is Rez's identity/account.

## The atom (Rez only): provide a Stripe secret key
Pick ONE, lightest first:

1. **Store it in 1Password once (best — fully hands-off after):**
   ```
   op item create --category "API Credential" --title STRIPE_API_KEY \
     --vault Division "credential=sk_live_xxx"
   ```
   Then the loop runs `scripts/stripe_rail_setup.sh` with zero args and the rail arms itself.

2. **Or hand the key to the loop directly:** `scripts/stripe_rail_setup.sh sk_live_xxx`
   (or `sk_test_xxx` to prove the whole loop end-to-end with zero money at risk first).

Either way, `scripts/stripe_rail_setup.sh` then (idempotently): creates/reuses the $9.99/mo Price,
(re)creates the `/stripe/webhook` endpoint and captures its signing secret, pushes all three as
Worker secrets via the CF token, mirrors them to 1Password, and verifies a live checkout URL is
returned. One command, no other Rez action.

## No longer blocking
- **Cloudflare deploy** — ALIVE (CF token in 1Password; see note above). `deploy-credentials-dead.md`
  is now RESOLVED.
- **GitHub push/PRs** — `GH_TOKEN` is still 401, but this does NOT block the fiat rail or deploys
  (wrangler deploys straight from the working tree; commits queue locally). It only blocks pushing
  to github.com / opening PRs. Separate, lower-priority atom: `github-pat-expired.md`.

## Open product question (not a blocker, flagged for the crew)
The wired SKU is "$9.99/mo -> 100 API credits" = selling our raw API to devs, which is the
listing-desert lane the margin pivot moved away from. The rail itself is SKU-agnostic; once armed,
point it at a packaged-OUTCOME SKU for a human audience (the margin thesis). Arming the rail is the
prerequisite either way.
