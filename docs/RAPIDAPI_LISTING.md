# Publishing x402 Data API on RapidAPI

This document explains how to create and publish the x402 Data API on the RapidAPI marketplace.

---

## STATUS 2026-07-30 — code rail BUILT, DEPLOYED, VERIFIED

Steps 1 and 2 below are **already done**. Do not redo them.

- `RAPIDAPI_PROXY_SECRET` is **set as a Worker secret** (confirmed in `wrangler secret list`).
- The bypass is **deployed** (version `030d5199-22e3-4c42-9408-9d550ab244f0`), `tsc --noEmit` exit 0.
- **Payout account (PayPal) is connected on RapidAPI** — it is the only payout rail they
  offer, so there was no choice to make.

Verified live against production, all three cases, not assumed:

| case | `/crypto/prices` | `/defi/yields` | `/chain/gas-price` |
|---|---|---|---|
| correct secret | **200** (real payload) | **200** | **200** |
| wrong secret | 402 | 402 | 402 |
| no header | 402 | 402 | 402 |

`/health` still returns 200 — free paths are unaffected. The compare is constant-time
(`timingSafeEqual` in `src/index.ts`) and the secret is never logged; only an anonymous
`rapidapi_call` event is emitted so marketplace volume stays countable.

**Remaining work is the listing itself — Step 3 onward.**

---

## Prerequisites

- A live x402 instance deployed to Cloudflare Workers (e.g., `https://x402-data-api.sigrunner.workers.dev`)
- A RapidAPI developer account (free tier sufficient)
- A shared secret for the RapidAPI proxy authentication

## Step 1: Generate the Proxy Secret  ✅ DONE

The RapidAPI proxy will identify itself using a shared secret sent in the `X-RapidAPI-Proxy-Secret` header. Generate a strong random value and set it in your production Worker:

```bash
# Generate a secure random secret
openssl rand -hex 32

# Store it in production Cloudflare Workers
wrangler secret put RAPIDAPI_PROXY_SECRET
# Paste the generated value when prompted
```

**Important:** Never commit the real secret to git. It's managed via `wrangler secret` (stored in Cloudflare's secure storage) and will override the placeholder in `.dev.vars.example`.

## Step 2: Verify the OpenAPI Spec

RapidAPI imports the API schema directly from your live endpoint. Verify it's accessible:

```bash
curl -s https://x402-data-api.sigrunner.workers.dev/openapi.json | jq '.info | {title, version, description}' -r
```

The spec is auto-generated at `src/index.ts:551` and includes all 19 API paths. **Do NOT create a static `openapi.json` file** — it would drift from the live spec. RapidAPI fetches it dynamically.

## Step 3: Create the RapidAPI Listing

1. **Log in to RapidAPI:** https://rapidapi.com/
2. **Navigate to the Developer Dashboard**
3. **Click "Add New API"**
4. **Fill in the listing details:**
   - **API Name:** `x402 Data API` (or `x402` for brevity)
   - **API Description:** 
     > Real-time blockchain, DNS, WHOIS, and domain intelligence API. Get Base mainnet data, domain registration info, DNS records, and threat intelligence with per-request payment via x402. No subscriptions — pay only for what you use.
   - **Base URL:** `https://x402-data-api.sigrunner.workers.dev`
   - **Authentication Type:** `Custom Header` → `X-RapidAPI-Proxy-Secret`
   - **Custom Header Value:** (paste the secret from Step 1)

5. **Import the OpenAPI Spec:**
   - Click "Import from URL"
   - URL: `https://x402-data-api.sigrunner.workers.dev/openapi.json`
   - RapidAPI will auto-populate all endpoints, parameters, and response schemas

6. **Set Pricing:**
   - RapidAPI handles billing on its side. Buyers pay per request (or subscribe to a plan).
   - Recommended: **Free tier** (limited requests/month) + **Pro tier** ($9.99/month for ~10k requests)
   - All requests are proxied to our x402 gate, which bills per-call on the blockchain

7. **Review Endpoints:**
   - Verify all 19 paths appear (chain/*, crypto/*, recon/*, etc.)
   - Check that required parameters (e.g., `address`, `domain`, `cve_id`) are marked
   - Mark any FREE paths as "Non-billable" (e.g., `/health`, `/`, OpenAPI spec endpoint)

8. **Publish:**
   - Click "Publish API"
   - Your listing goes live immediately (or after moderation, depending on RapidAPI's current flow)

## How It Works

1. **Buyer subscribes on RapidAPI** → RapidAPI charges them
2. **Buyer calls via RapidAPI** → RapidAPI proxies request to `https://x402-data-api.sigrunner.workers.dev`
3. **RapidAPI adds header** → `X-RapidAPI-Proxy-Secret: <secret>`
4. **Our auth middleware checks header** → Sees valid secret, marks as "already paid", skips x402 gate
5. **Request proceeds** → No 402 Payment Required; buyer gets the data
6. **RapidAPI settles** → RapidAPI keeps its cut, pays us via their standard settlement (or we check earnings in their dashboard)

RapidAPI does NOT speak x402 — it collects money from buyers on its platform and proxies requests. Our job is to recognize the proxy secret and let paid traffic through.

## Testing Before Publishing

Once the secret is set in production:

```bash
# Without secret → should hit x402 gate and return 402
curl -s https://x402-data-api.sigrunner.workers.dev/chain/eth/balance/0x1234...

# With secret → should return data
curl -s \
  -H "X-RapidAPI-Proxy-Secret: <your-secret>" \
  https://x402-data-api.sigrunner.workers.dev/chain/eth/balance/0x1234...
```

Logs (Cloudflare dashboard → Logs) will show `event: "rapidapi_call"` for authenticated requests.

## Monitoring & Analytics

- **RapidAPI Dashboard:** Shows subscriber count, request volume, earnings
- **Our Logs:** Filter by `event: "rapidapi_call"` to track volume and usage patterns
- **Earnings:** Check RapidAPI's payment schedule (typically monthly)

## Troubleshooting

**Buyer gets 402 on RapidAPI call:**
- Verify the secret in Step 1 was copied exactly into the RapidAPI listing
- Check Cloudflare logs for `rapidapi_call` event (should appear if auth succeeded)
- Verify endpoint is not in the free tier (free paths bypass x402 regardless)

**OpenAPI spec not updating:**
- RapidAPI caches specs. Wait 5–10 minutes or force refresh in their UI
- Verify the live endpoint still returns valid schema: `curl https://x402-data-api.sigrunner.workers.dev/openapi.json`

**Secret leaked:**
- Immediately rotate: `wrangler secret put RAPIDAPI_PROXY_SECRET` with a new value
- Update the RapidAPI listing with the new secret
- Old requests will fail with 402 (buyers will report issues, then you swap the secret back temporarily while fixing their subscriptions)

## Revenue Share & Pricing Model

RapidAPI typically takes ~30% of revenue and pays us ~70%. The exact split depends on the plan type. Buyers on RapidAPI's free tier may be able to call your API at no cost to them (RapidAPI covers it from ad revenue or platform fees). Check RapidAPI's revenue share terms in your account settings.

For maximum earnings, monitor:
- Request volume per subscriber tier
- Chargeback/dispute rates
- Geographic distribution (can inform pricing tiers)
- Competitor pricing on RapidAPI (adjust if needed)

## One-Time Setup Checklist

- [ ] Generate `RAPIDAPI_PROXY_SECRET` and store via `wrangler secret put`
- [ ] Create RapidAPI account if not present
- [ ] Add new API listing on RapidAPI
- [ ] Import OpenAPI spec from live endpoint
- [ ] Set pricing tiers (free + pro recommended)
- [ ] Paste secret into RapidAPI auth field
- [ ] Test with curl (with/without header)
- [ ] Publish listing
- [ ] Monitor first 48h for 402 errors in logs
- [ ] Update RapidAPI description / logo / tags as needed

Once published, the listing is live and buyers can start using it immediately.
