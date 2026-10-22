# Blocker — List Grey Ridge on the Circle Agent Marketplace (on-oracle USDC channel)

**Owner:** Rez (one irreducible step — a Google sign-in to submit the intake form).
**Why this one matters more than the others:** Circle is the USDC issuer. Its Agent Marketplace
settles in **USDC on Base** — meaning revenue from this channel lands in our x402 receiving wallet
`0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`, which **is the completion oracle**. (RapidAPI, by
contrast, pays fiat to PayPal and never touches the wallet oracle.) The lane's top data earner,
LoneStarOracle, is listed here under `FINANCIAL_ANALYSIS` with full provider metadata. **We are
absent** — a live query of Circle's public Discovery API for our payout wallet returns `total: 0`.

## State as of 2026-10-22
- **Discovery API (public, no auth):** `GET https://api.circle.com/v2/x402/discovery/resources?payTo=0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10` → `{"items":[],"total":0}` (confirmed absent).
- **All listing prerequisites already met and live** (nothing to build):
  - 402 payment endpoints: e.g. `https://x402-data-api.sigrunner.workers.dev/gate/swap` returns `402 Payment Required` unpaid, serves paid. ✓
  - Published OpenAPI spec: `https://x402-data-api.sigrunner.workers.dev/openapi.json` → `200`. ✓
  - Payout wallet (sanctions-screened on review): `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`. ✓
  - Discovery manifest, category-aligned: `https://x402-data-api.sigrunner.workers.dev/.well-known/x402` now carries `category: "FINANCIAL_ANALYSIS"`. ✓

## The one step (Rez)
Open the intake form and submit it. **It requires a Google sign-in** (the form is access-restricted;
anonymous curl submission returns 401). Use any Google account — ideally the Grey Ridge one.

**Form:** https://forms.gle/7YFzvdmMcn1JH5tF6
(redirects to `docs.google.com/forms/d/e/1FAIpQLSeVGlFm-rglBEd8nPqWTdbg2XIe8jY7dd43iFC-FhP2WANQvQ/viewform`)

### Exact values to paste (copy verbatim)
| Field | Value |
|---|---|
| Service / endpoint URL | `https://x402-data-api.sigrunner.workers.dev` |
| OpenAPI spec URL (if asked) | `https://x402-data-api.sigrunner.workers.dev/openapi.json` |
| Payout wallet address | `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10` |
| Network / asset | Base — `eip155:8453`, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Category | `FINANCIAL_ANALYSIS` |
| Contact email | `contact@greyridgesignals.ai` |

**Short description (Grey Ridge voice, measured — paste as-is):**
> Grey Ridge Signals — pay-per-call pre-trade token safety and market data for Base trading agents
> over x402. Flagship: a GO/HOLD/BLOCK swap gate sized to the trade ($0.008), a SAFE/CAUTION/AVOID
> token report with measured transfer tax ($0.01), and a live honeypot/sellability simulation
> ($0.009) — a honeypot check for a fraction of what rival Base token-safety APIs charge. Plus DeFi
> yields, cross-venue funding rates, prices, Polymarket markets and 20+ Base RPC/chain reads. No
> account, no API key; agents pay inline in USDC on Base from $0.001/call. OpenAPI and a
> machine-readable x402 manifest are published; uptime is measured and public.

## After submission
- Circle reviews manually, sanctions-screens the payout wallet, then lists + continuously health-checks.
- Verify it went live (re-run the Discovery API query above; expect `total ≥ 1`).
- A real agent purchase through this channel settles USDC to the wallet → the first on-oracle external dollar.

_Everything buildable was done; this is the single sign-in-gated step. No capital, no bug-bounty — just the form._
