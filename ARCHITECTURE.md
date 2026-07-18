# ARCHITECTURE — x402-data-api

**Source of truth for what is actually shipped.** Verified against `src/index.ts` on
2026-07-18. Where a claim in another doc conflicts with the code, the code wins and the
conflict is recorded in [Doc-drift corrections](#doc-drift-corrections). Prices, counts,
and route lists below were read out of the code, not copied from prose.

---

## 1. What it is

A single [Cloudflare Worker](./src/index.ts) (~4,200 lines) that serves pay-per-call
crypto / DeFi / prediction-market / Base on-chain data **and** MCP-security scanning over
the [x402 payment protocol](https://x402.org) on **Base mainnet** (`eip155:8453`, USDC).
No account / API key / subscription: an agent pays inline in USDC and gets the data back in
the same request. Every data endpoint exposes a **free preview**.

- **Deployed:** `https://x402-data-api.sigrunner.workers.dev`
- **MCP endpoint (streamable-http):** `/mcp`
- **Runtime:** Cloudflare Workers, `nodejs_compat`, `compatibility_date = 2025-06-01` (`wrangler.toml`)
- **Framework:** Hono 4 + `@x402/hono` `paymentMiddleware` / `x402ResourceServer`
- **Settlement:** **xpay** non-custodial facilitator (`FACILITATOR_URL=https://facilitator.xpay.sh`,
  `FACILITATOR_MODE=xpay`). No Coinbase/CDP account is required to settle. `PAY_TO` is a Base
  wallet Rez controls (`0x5765…`, overridable via `wrangler secret put PAY_TO`).

## 2. Request path & payment gate

1. Global middleware builds the paid-route map (`makeRoutes(PAY_TO)`) once and caches it
   (`cachedMiddleware`), then delegates to `@x402/hono` `paymentMiddleware`.
2. A gated route with no valid payment → **HTTP 402** with an x402 v2 challenge
   (network `eip155:8453`, asset USDC). An x402-capable client signs an EIP-3009
   authorization and retries; the middleware verifies + settles via xpay.
3. **CDP is used only** for the one-time Bazaar catalog seed via `/internal/cdp-settle-raw`
   (which bypasses the `@x402` resource server); switching `FACILITATOR_MODE` to `cdp` would
   break settlement on declared routes on Workers (ajv `new Function` is blocked) — see the
   note in `wrangler.toml`.
4. All upstreams are **free/keyless** public APIs (DefiLlama, Hyperliquid, OKX, dYdX,
   Polymarket Gamma, Base JSON-RPC with multi-provider failover, NVD/EPSS/CISA-KEV,
   crt.sh/RDAP/DoH). Inputs are validated and SSRF-guarded; the only user-supplied fetch
   targets are the explicitly-scoped `/scan/mcp`, `/dns`, `/whois`, and enrichment routes.

## 3. Paid endpoint inventory (code-verified)

**18 paid `GET` endpoints** are registered in `makeRoutes()` (plus `POST /mcp`). Prices are
the actual `makeRoutes` values.

| Endpoint | Price | In README? | In `.well-known/x402`? |
|---|---|:--:|:--:|
| `GET /crypto/prices` | $0.001 | ✓ | ✓ |
| `GET /crypto/funding` | $0.001 | ✓ | ✓ |
| `GET /defi/yields` | $0.001 | ✓ | ✓ |
| `GET /pm/markets` | $0.005 | ✓ | ✓ |
| `GET /chain/block-number` | $0.001 | ✓ | ✓ |
| `GET /chain/gas-price` | $0.001 | ✓ | ✓ |
| `GET /chain/balance` | $0.001 | ✓ | ✓ |
| `GET /chain/token-balance` | $0.001 | ✓ | ✓ |
| `GET /chain/tx` | $0.001 | ✓ | ✓ |
| `GET /chain/receipt` | $0.001 | ✓ | ✓ |
| `GET /chain/code` | $0.001 | ✓ | ✓ |
| `GET /chain/wallet` | $0.003 | ✓ | ✓ |
| `GET /chain/token-security` | $0.02 | ✗ (missing) | ✓ |
| `GET /scan/mcp` | $0.10 | ✓ | ✓ |
| `GET /enrich/tech-risk` | $0.05 | ✓ | ✓ |
| `GET /enrich/domain` | $0.01 | ✓ | ✓ |
| `GET /dns/:domain` | $0.01 | ✗ (missing) | ✗ (not advertised) |
| `GET /whois/:domain` | $0.02 | ✗ (missing) | ✗ (not advertised) |

`.well-known/x402` advertises **16** of these (it omits `/dns`, `/whois`, and `/mcp`).
`/dns` and `/whois` are fully implemented (DoH + RDAP) and payment-gated, but they are
**invisible to discovery** — absent from README, `.well-known/x402`, and `openapi.json`.

**Free routes (ungated):** `/`, `/health`, `/.well-known/x402`, `/.well-known/mcp-registry-auth`,
`/.well-known/402index-verify.txt`, `/openapi.json`, `/llms.txt`, and the previews:
`/crypto/prices/preview`, `/crypto/funding/preview`, `/defi/yields/preview`,
`/pm/markets/preview`, `/chain/block-number/preview`, `/chain/gas-price/preview`,
`/chain/token-security/preview`, `/scan/mcp/preview`. Internal: `/internal/cdp-probe`,
`/internal/cdp-settle-raw` (Bazaar seed only).

**Differentiators actually in the code** (not just claims): cross-venue funding with
**Hyperliquid + OKX + dYdX** and arb spread; DeFi yields with 1d/7d/30d APY trend + IL risk +
DefiLlama stability forecast; EIP-7702 delegated-EOA detection on `/chain/code` and
`/chain/wallet`; USD cross-pricing on chain reads; and `/chain/token-security` — a real
`eth_call` state-override honeypot simulation + proxy/bytecode selector scan (own compute,
not a GoPlus wrapper).

## 4. MCP server — **22 tools** (code-verified)

`initialize`, `notifications`, and `tools/list` are **free** (discovery); paid `tools/call`
returns an x402 challenge. Preview tools are in the `FREE_TOOLS` set and stay free.

- **14 paid tools:** `crypto_prices`, `crypto_funding`, `defi_yields`, `pm_markets`,
  `chain_block_number`, `chain_gas_price`, `chain_balance`, `chain_token_balance`,
  `chain_tx`, `chain_wallet`, `chain_token_security`, `enrich_tech_risk`, `enrich_domain`,
  `scan_mcp_server`.
- **8 free tools:** `crypto_prices_preview`, `crypto_funding_preview`, `defi_yields_preview`,
  `pm_markets_preview`, `chain_block_number_preview`, `chain_gas_price_preview`,
  `chain_token_security_preview`, `scan_mcp_preview`.

The MCP surface is a **subset** of the HTTP surface: `/chain/code`, `/chain/receipt`,
`/dns`, and `/whois` have HTTP routes but **no MCP tool**.

## 5. Discovery / distribution surfaces

**In the code (served by the Worker):** `/.well-known/x402` (16 routes for x402 crawlers),
`/openapi.json`, `/llms.txt`, `/.well-known/mcp-registry-auth`, `/.well-known/402index-verify.txt`.

**External registrations (mechanisms present in repo; state per handoffs, not re-verified live):**
- **MCP Registry:** `server.json` = `io.github.rezearcher/tech-risk` **v1.2.0**; published via
  `mcp-publisher`.
- **x402scan.com:** `register_x402scan.js` — SIWX wallet-sign to the registry API.
- **CDP Bazaar:** `seed_endpoint.js` / `seed_*.js` — catalog seed (search reported broken).
- **402index.io:** domain-verified via `/.well-known/402index-verify.txt`.

## 6. The five 2026-07-17/18 "completed" tasks — reality check

**These five kanban tasks closed in the last 24h, but the repo shows no file modified after
2026-07-16 23:27.** None left a committed code/doc artifact here. A closed task title is a
claim; below is what the code/repo actually proves. Treat every "shipped" wording elsewhere
for these as **unverified** until an artifact exists.

| Task | Repo evidence | Verdict |
|---|---|---|
| `t_15d021aa` Prospector: research NEW demand + 3 distribution channels | None in repo. Channel *targets* were already catalogued in `docs/FIRST_DOLLAR_PLAYBOOK.md` (pre-existing). | **GAP / unverified** — no evidence 3 NEW channels were secured. Outputs, if any, live in Division memory / kanban. |
| `t_dd214b6b` Diagnose + draft nudges for 5 open distribution PRs | None in repo. The 5 open offers are named only in the EVENING_003 handoff (BankrBot #573, awesome-mcp-servers #10277, awesome-x402 #868, mcp.so #3190, aeon #745). | **Unverified** — nudge drafts are not in the repo; PR merges are exogenous and still pending. |
| `t_a1408407` Apify Base RPC Actor — publish to 20k+ pipelines | **No Apify actor exists** — no `actor.json`, no actor source, no `apify` code anywhere. Only planning mentions in `FIRST_DOLLAR_PLAYBOOK` (Tier B). | **GAP — not built.** "Published to 20k+ agent pipelines" is unproven; nothing in this repo implements it. |
| `t_39a77a4a` MCP Directory Flood — submit to 8 directories | Repo shows MCP Registry (`server.json`) + mcp.so `#3190` (an earlier commit) + Glama/PulseMCP noted "needs repo"/"web-form" pending in `FIRST_DOLLAR_PLAYBOOK`. | **Partial / unverified** — no evidence of 8 fresh submissions in one pass; the artifacts present pre-date the task window. |
| `t_e6242d7e` x402scan Composer + Bazaar Indexing | `register_x402scan.js` (SIWX registration) and `seed_*.js` (Bazaar seeders) exist, **but all are dated 2026-07-16** — before the task window. No "Composer" artifact. | **Mechanism pre-exists; this task's specific output unverified.** |

## 7. Doc-drift corrections (statements the code disproves)

- **MCP tool count.** Code has **22** tools. `README.md` said **19**; `docs/DISTRIBUTION_READY.md`
  said **11**. Both were wrong (README + DISTRIBUTION_READY corrected 2026-07-18).
- **Missing endpoints in README.** `/chain/token-security`, `/dns/:domain`, `/whois/:domain`
  are live + paid but were absent from the README endpoint tables (token-security added
  2026-07-18; `/dns` + `/whois` noted).
- **Paid-endpoint count.** `DISTRIBUTION_READY` said "15 paid endpoints (4 data + 8 Base RPC +
  3 security)". Actual = **18 paid GET endpoints** (adds `/chain/token-security`, `/dns`, `/whois`).
- **Funding venues.** Code fetches **Hyperliquid + OKX + dYdX**; README said only Hyperliquid + OKX
  (corrected 2026-07-18).
- **`PLAN.md` status section is stale** — it lists only the two `/enrich/*` endpoints as the MCP
  surface; the shipped surface is 22 MCP tools / 18 paid HTTP endpoints. See this file for current state.

## 8. Explicit gaps (planned / claimed but not shipped here)

- **First organic dollar: still $0.** On-chain-verified: every inbound USDC to `PAY_TO` came from
  our own buyer wallet (`0xC4852c…`). This is the one exogenous remainder — not fakeable, not forceable.
- **The revenue atom (only Rez can do it):** create a **RapidAPI seller account + connect Stripe
  payout** at `rapidapi.com/provider`. The dual-rail (x402 + RapidAPI/Stripe) plan hinges on it;
  everything downstream (import `/openapi.json`, tiers, token-security as hero) is automatable once it exists.
- **Apify actor:** not built (see §6).
- **`/dns` + `/whois` discovery:** live but undiscoverable — not in `.well-known/x402` or `openapi.json`.
- **Next moat builds (not started):** indexed event history (free RPC caps `eth_getLogs` at ~10
  blocks → needs a D1/KV indexer, must respect the ~50-subrequest/invocation cap); cross-DEX
  best-quote/price-impact on Base; Aave/Moonwell near-liquidation monitor.

---

*See `docs/FIRST_DOLLAR_PLAYBOOK.md` (thesis + outreach targets), `docs/DISTRIBUTION_READY.md`
(distribution state), `docs/QUALITY_UPGRADE_PLAN.md` (endpoint quality), and
`docs/MARKET_ANALYSIS_2026-07-16.md` (market thesis). This file supersedes their code-level claims.*
