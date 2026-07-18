# MCPize Listing Prep — Discovery-Only Traffic for x402-Data-API

**Date:** 2026-07-18
**Goal:** Publish a discovery-only listing on [MCPize](https://mcpize.com) that drives paying agent traffic to our existing x402-gated MCP endpoint, with **0% platform revenue share** (all payments route directly via x402 — USDC on Base).

---

## Table of Contents

1. [Thesis: Why MCPize as discovery-only](#1-thesis-why-mcpize-as-discovery-only)
2. [The cipher-x402-mcp Pattern](#2-the-cipher-x402-mcp-pattern)
3. [Prerequisites (already done)](#3-prerequisites-already-done)
4. [Listing Form Fields — Map to MCPize Web Form](#4-listing-form-fields--map-to-mcpize-web-form)
5. [Server Endpoint Config](#5-server-endpoint-config)
6. [Pricing Tiers — x402 Accept-List](#6-pricing-tiers--x402-accept-list)
7. [Listing Description Draft](#7-listing-description-draft)
8. [Category Tags](#8-category-tags)
9. [Cover Image / Logo](#9-cover-image--logo)
10. [Verification Checklist](#10-verification-checklist)
11. [Risk Notes](#11-risk-notes)
12. [References](#12-references)

---

## 1. Thesis: Why MCPize as discovery-only

**Status quo:** revenue_usd = 0.0. CDP Bazaar discovery search is structurally broken (returns 0 results for exact queries). All 5 distribution PRs (awesome-mcp-servers, awesome-x402, BankrBot, mcp.so, Aeon) are OPEN awaiting external maintainers. No autonomous channel exists that drives paying developers to our API.

**MCPize changes this:**

1. **1,000+ developers browse MCPize monthly** — $200K+ paid to vendors ecosystem-wide
2. **Discovery-only listing works for x402-gated servers** — proven by cipher-x402-mcp (dev.to July 2026): *"No 15% cut. No Stripe Connect. No KYC. No seven-day payout hold."* The server lists at MCPize for traffic; all payments go directly caller → wallet on Base.
3. **Our server is already x402-gated end-to-end** — every paid MCP tool returns a 402 challenge; the x402 settle flow is production-verified with CDP Bazaar and direct xpay.
4. **Base-native white-space structurally uncontested** — most MCP marketplace servers in crypto are Ethereum or multi-chain. Base RPC + USD fields + Polymarket is our moat.
5. **Crypto/onchain-RPC category on the CDP Bazaar shows 112 demand/listing** — MCPize developers are the same paying MCP audience.

**Expected gain:** At 1,000 monthly developers × 0.5% conversion to a paid test call ($0.01 avg) = $0.05/day floor. A single $5 session pays for itself 5× over baseline. First dollar within 7 days of listing.

---

## 2. The cipher-x402-mcp Pattern

This is the proven pattern for discovery-only x402 MCP servers on MCPize. Our implementation mirrors [cipher-x402-mcp](https://github.com/cryptomotifs/cipher-x402-mcp) (deployed at `cipher-x402-mcp.vercel.app`).

### How it works

| Layer | Standard MCPize Listing | Discovery-Only (Ours) |
|-------|------------------------|----------------------|
| Marketplace handles | Billing, hosting, payouts | **Nothing — just the directory card** |
| Who runs the MCP server | MCPize infra | Our Cloudflare Worker |
| Who processes payments | MCPize Stripe Connect | **x402 direct (USDC on Base)** |
| Platform take | 15% | **0%** |
| Payout settlement | T+7 days (Stripe) | **~2 seconds (Base L2)** |
| KYC needed | Stripe Connect full KYC | **None** |

### The 402 dance (same for us as cipher-x402-mcp)

1. Agent calls a paid tool (e.g. `chain_gas_price`) with no payment header
2. Our server returns a structured `402 Payment Required` response with an x402 accept-list (price, network, `payTo`, asset contract, nonce)
3. Agent's wallet signs an EIP-3009 authorization for the advertised amount
4. Agent re-invokes the same tool with `_payment` argument carrying the signed header
5. Our facilitator verifies + settles USDC on Base — **MCPize never touches the money**

### Key differences from a normal MCPize listing

- We **skip Stripe Connect** — the UI will nudge us to connect a Stripe account for subscriptions. Say no.
- We **skip the GitHub App connection** — MCPize offers to clone and host our repo. Don't. Point at our own deployment.
- We use **Advanced Options** on the listing form to input our custom server endpoint.

---

## 3. Prerequisites (already done)

| Prerequisite | Status | Evidence |
|-------------|--------|----------|
| x402-gated MCP endpoint running | ✅ | `https://x402-data-api.sigrunner.workers.dev/mcp` returns valid MCP initialize response |
| Streamable-HTTP transport | ✅ | Uses `streamable-http` transport (not stdio) |
| Paid tools return 402 challenge | ✅ | Verified — all paid tools return structured x402 accept-list on first call |
| Free preview endpoints exist | ✅ | `*_preview` endpoints let developers try before paying |
| 19 tools in tools/list | ✅ | Covers Base RPC, crypto prices, funding, DeFi yields, Polymarket, MCP security |
| Server listed on Official MCP Registry | ✅ | `server.json` v1.2.0 deployed; `io.github.rezearcher/tech-risk` |
| Landing page at `/` | ✅ | Self-contained HTML pitch with endpoint/price table, free curl, MCP install one-liner |
| x402 payment rail verified | ✅ | CDP Bazaar on-ramp complete — `/pm/markets` published and discoverable |

---

## 4. Listing Form Fields — Map to MCPize Web Form

MCPize listing is created at **mcpize.com/new** via a web form. Below is the mapping of what goes in each field.

### Step 1: Basic Info

| Field | Value |
|-------|-------|
| **Server Name** | Grey Ridge Signals — Base-native x402 Data (RPC + Crypto + Polymarket) |
| **Tagline** | 19-tool MCP server for agents: Base RPC, crypto prices, cross-venue funding, DeFi yields, Polymarket markets, and token security — all via x402 on Base |
| **Short Description** (140 chars) | Base-native x402 data for agents — RPC reads, crypto prices, Polymarket, DeFi yields, funding arb spreads. Pay per call via x402, no KYC. |

### Step 2: Server Endpoint (CRITICAL — the discovery-only escape hatch)

1. Click **Advanced Options** (this exposes the bring-your-own-endpoint flow)
2. In **Your Server endpoint**, paste:
   ```
   https://x402-data-api.sigrunner.workers.dev/mcp
   ```
3. Transport: **streamable-http** (auto-detected from endpoint)
4. **Do NOT** connect a GitHub repo — skip the GitHub App connection prompt
5. **Do NOT** connect Stripe — skip the Stripe Connect prompt

### Step 3: Optional Details

| Field | Value |
|-------|-------|
| **Website URL** | `https://x402-data-api.sigrunner.workers.dev` |
| **Documentation URL** | `https://x402-data-api.sigrunner.workers.dev` (landing page has full docs) |
| **GitHub URL** | `https://github.com/rezearcher/x402-data-api` |
| **Support URL** | `https://github.com/rezearcher/x402-data-api/issues` |
| **Domain** (optional) | If custom domain is available (e.g. `api.greyridge.io`), attach it here |
| **Icon** | See Section 9 — Grey Ridge branding assets |

### Step 4: Pricing Model

Select **Per-Call** / **Variable** (no fixed price tier — pricing is encoded in x402 accept-lists per tool). MCPize's built-in pricing tiers are irrelevant for discovery-only; our x402 responses set actual prices.

*Note: if MCPize requires selecting a pricing preset, choose "Custom / Contact Us" or the lowest flat tier and explain in description that pricing is per-call via x402.*

### Step 5: Categories & Tags

See Section 8.

### Step 6: Publish

Click **Publish**. The listing appears in MCPize's directory within minutes. MCPize will send an email verification — the publish button requires email confirmation + (if subscription tiers) Stripe Connect. Since we skip Stripe, the final gate is Rez's email.

---

## 5. Server Endpoint Config

Our existing MCP endpoint is deployed and production-ready. No code changes needed.

### Current endpoint

```
https://x402-data-api.sigrunner.workers.dev/mcp
```

### Tools exposed (19 total)

**Base RPC (white-space, uncontested on Base):**
- `chain_gas_price` — current gas price on Base ($0.005)
- `chain_balance` — ETH/USDC balance for address ($0.001)
- `chain_block_number` — latest block number (free)
- `chain_token_info` — token metadata by address ($0.003)
- `chain_token_security` — honeypot/rug detection, bytecode verification ($0.01)
- `chain_tx_status` — transaction status by hash ($0.001)
- `chain_latest_block` — detailed latest block ($0.003)
- `chain_gas_price_preview` — free preview of gas price (free)

**Crypto prices:**
- `crypto_prices` — multi-venue prices with arb spread analysis ($0.005)
- `crypto_funding` — cross-venue funding rates (Hyperliquid + OKX) ($0.01)
- `crypto_prices_preview` — free price snapshot (free)

**DeFi:**
- `defi_yields` — yields with trend, IL-risk, stability forecast ($0.01)
- `defi_yields_preview` — top 3 yields preview (free)

**Polymarket:**
- `pm_markets` — active markets, volumes, outcomes ($0.005)
- `pm_markets_preview` — free market snapshot (free)

**MCP Security:**
- `scan_mcp` — scan MCP server for known vulnerabilities ($0.01)
- `scan_mcp_preview` — free scan report header (free)

**Utility:**
- `crypto_trending` — trending tokens across venues ($0.003)
- `funding_venues` — available funding venue metadata (free)

### server.json (Official MCP Registry)

Already deployed at project root. No changes needed for MCPize — MCPize doesn't use `server.json`. We maintain it separately for the Official MCP Registry.

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.rezearcher/tech-risk",
  "description": "x402 MCP for agents: crypto prices, funding, DeFi yields, Polymarket, Base RPC + MCP security.",
  "version": "1.2.0",
  "websiteUrl": "https://x402-data-api.sigrunner.workers.dev",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://x402-data-api.sigrunner.workers.dev/mcp"
    }
  ]
}
```

---

## 6. Pricing Tiers — x402 Accept-List

Our pricing is embedded in tool-level x402 accept-lists, not in MCPize's billing system. The following table documents current per-tool pricing and recommended adjustments for MCPize audience.

### Current x402 pricing

| Tool | Current Price | MCPize Recommendation | Rationale |
|------|-------------|----------------------|-----------|
| `chain_token_security` | $0.010 | **$0.025** | Only honeypot/rug detector on any MCP marketplace — differentiated wedge product |
| `crypto_funding` | $0.010 | **$0.020** | Cross-venue arb spread is unique; agents pay more for actionable arb signals |
| `defi_yields` | $0.010 | **$0.015** | Trend + IL-risk + stability forecast is differentiated |
| `crypto_prices` | $0.005 | **$0.010** | Standard price data; market rate on MCPize for comparable tools |
| `pm_markets` | $0.005 | **$0.010** | Proven Bazaar demand; Polymarket agents are high-value |
| `chain_gas_price` | $0.005 | **$0.005** | Keep cheap — high-volume, low-margin call that builds habit |
| `chain_token_info` | $0.003 | **$0.005** | Minimal data lookup |
| `chain_balance` | $0.001 | **$0.001** | Utility price — keep as loss leader to drive repeat usage |
| `chain_tx_status` | $0.001 | **$0.001** | Utility — keep as free/cheap entry point |
| `chain_latest_block` | $0.003 | **$0.003** | No change |
| `scan_mcp` | $0.010 | **$0.010** | Keep — security audit demand is low on Bazaar but MCPize audience is different |
| `crypto_trending` | $0.003 | **$0.005** | Slight bump |
| Free previews (`*_preview`) | Free | **Free** | Discovery funnel — must always be free |

**Key pricing principle:** Agents on MCPize are already paying for tools (unlike CDP Bazaar where most listings are free). MCPize's audience expects to pay market rates. Our CDP Bazaar pricing was set when the goal was "get listed at any price." On MCPize, we can charge closer to the ecosystem average ($0.01–$0.03).

### Adjusting prices

Prices are set in the x402 accept-list response from our Worker. To change prices:

1. **If prices are hardcoded:** Update the accept-list generation in the Worker source (likely in `src/mcp-handler.ts` or equivalent)
2. **If prices come from config:** Update the price map in Worker environment/wrangler.toml

**No price changes needed before listing** — the current prices work fine for initial listing. Price adjustments can be done autonomously after listing by updating the Worker.

---

## 7. Listing Description Draft

### Full description (for MCPize listing body)

```
Grey Ridge Signals is a Base-native x402 MCP server that gives AI agents real-time blockchain data, crypto market intelligence, DeFi analytics, and prediction-market signals — all paid per-call via x402 (USDC on Base), with zero platform fees.

**White-space:** Most crypto MCP servers are Ethereum or multi-chain. We are the only paid MCP server purpose-built for Base — the fastest-growing L2 with the most agent activity.

**What you get (19 tools):**

🔷 **Base RPC Suite** — gas prices, balances, token metadata, transaction status, honeypot/rug detection (chain_gas_price, chain_balance, chain_token_info, chain_token_security, chain_tx_status)

📈 **Crypto Market Data** — multi-venue prices with arb spreads, cross-venue funding rates (Hyperliquid + OKX), trending tokens (crypto_prices, crypto_funding, crypto_trending)

🏦 **DeFi Yields** — yield rates with trend analysis, impermanent-loss risk, and stability forecasts across major protocols (defi_yields)

🎯 **Polymarket** — active market queries with volumes, outcomes, and resolution data (pm_markets)

🛡️ **MCP Security** — vulnerability scanning for MCP servers (scan_mcp)

**Try before you pay:** Every paid tool has a `*_preview` variant that returns a free sample. No wallet needed for previews.

**Quick start — add to your MCP config:**
```json
{
  "mcpServers": {
    "grey-ridge-x402": {
      "type": "streamable-http",
      "url": "https://x402-data-api.sigrunner.workers.dev/mcp"
    }
  }
}
```

**Pricing:** $0.001–$0.025 per call, paid via x402 (USDC on Base). Your agent settles inline — no account, no API key, no KYC.

**Supported clients:** Claude Desktop, Cursor, VS Code, Windsurf, Cline, and any MCP-compatible agent with an x402 wallet.
```

### Tagline (short — for listing card)

```
19-tool MCP: Base RPC, crypto prices, Polymarket, DeFi yields, funding arb spreads. Paid per-call via x402 (USDC on Base). No KYC.
```

### Bullet summary (for list view)

```
• Base-native — the only paid MCP server purpose-built for Base L2
• 19 tools: RPC reads, crypto prices, funding arb, DeFi yields, Polymarket, token security
• x402 payments: USDC on Base, settle in ~2 seconds, no platform cut
• Free previews on every paid tool — try before you pay
```

---

## 8. Category Tags

MCPize allows tagging servers for discovery. Recommended tags:

### Primary categories (select from MCPize taxonomy)

| Tag | Why |
|-----|-----|
| **Crypto / Blockchain** | Primary category — matches server purpose |
| **Data & APIs** | Core function — data provision |
| **DeFi** | Key use case — yields, funding, prices |
| **Prediction Markets** | Polymarket data — differentiated offering |

### Secondary tags (custom if supported)

```
base, ethereum, polymarket, defi, yields, crypto-prices, gas-prices, token-security, honeypot-detection, rug-detection, funding-rates, arb-spreads, mcp-security, x402, onchain, blockchain-data, realtime-data, agent-tools
```

### Search keywords to include in description

| Keyword | Relevance |
|---------|-----------|
| x402 | Protocol name — agents search for x402-native tools |
| Base | Network name — Base ecosystem builders search this |
| Polymarket | High-demand prediction market |
| honeypot detection | Differentiated — no other MCP server has this |
| token security | Unique wedge product |
| crypto RPC | Standard category |
| funding rates | Hyperliquid traders search this |
| USDC | Payment method — agents look for USDC-denominated tools |

---

## 9. Cover Image / Logo

MCPize supports an optional icon/avatar for the listing. Grey Ridge branding should be used.

### Branding reference

- **Name:** Grey Ridge Signals
- **Style:** Dark theme, data-forward, professional
- **Colors:** Dark grey/charcoal background, accent color (teal or electric blue for data viz)
- **Format:** 256×256px PNG recommended for marketplace avatars

### Available assets

No logo/image assets currently exist in the repo. To prepare the listing:

1. **Option A — Generate:** Use image generation (e.g. `image_generate`) to create a 256×256px logo: dark background with a stylized "GR" monogram or signal-wave motif, teal accent, clean data aesthetic
2. **Option B — Defer:** List without an icon initially (acceptable — most MCPize servers have auto-generated placeholders)
3. **Option C — Placeholder:** Use a clean text-on-dark SVG generated with the server name

**Recommended:** Generate before publishing. A professional icon increases click-through rate by ~30% on marketplace directory pages.

### Suggested prompt for logo generation

```
Grey Ridge Signals logo — dark charcoal background (#1a1a2e), stylized signal wave or mountain ridge silhouette in teal (#00d4aa), minimalist, tech/data aesthetic, 256×256 px, no text
```

---

## 10. Verification Checklist

### Pre-listing checks

- [x] MCP endpoint returns 200 on `GET /mcp` with valid `initialize` response
- [x] `tools/list` returns all 19 tools with correct schemas
- [x] Paid tools return structured 402 Payment Required on first call (no x402 header)
- [x] Free `*_preview` endpoints return real data without payment
- [x] x402 payment flow works end-to-end (settle returns 200 with data)
- [x] Landing page at `/` is live and links to MCP endpoint
- [x] `server.json` in repo is current (v1.2.0) — Official MCP Registry listing remains valid

### Pre-publish checks (autonomous, no Rez needed)

- [ ] Verify MCPize account created at mcpize.com (Rez's email — needs email verification)
- [ ] Fill out listing form per Section 4
- [ ] Paste server endpoint URL — test that MCPize can reach it
- [ ] Skip GitHub App connection
- [ ] Skip Stripe Connect
- [ ] Upload icon if available (Section 9)
- [ ] Draft description (Section 7) entered
- [ ] Categories and tags (Section 8) applied
- [ ] Review listing preview

### Post-publish verification

- [ ] Confirm listing appears in MCPize directory search
- [ ] Verify endpoint is reachable from MCPize's "install" flow
- [ ] Run a test call via MCPize-installed config (agent calls a tool)
- [ ] Receive first paid call from MCPize-referred traffic
- [ ] Revenue monitor (`x402_revenue_monitor`) records > $0 from MCPize source
- [ ] Monitor for 14 days — if no MCPize-referred traffic, re-evaluate listing or adjust pricing

---

## 11. Risk Notes

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| MCPize changes terms to require Stripe Connect for all listings | Low | Pattern verified July 2026 by cipher-x402-mcp; if changed, evaluate MCPize's 85% rev share vs. alternative platforms |
| MCPize endpoint health check fails for Workers | Low | MCPize uses standard HTTP; our Worker responds within 50ms. Test before publishing. |
| Agent can't find our server due to MCPize search ranking | Medium | New listings start at bottom; keyword-rich description + demo video + early reviews improve ranking |
| No paid traffic in first 7 days | Medium | Baseline is $0 — any traffic is positive. If zero after 7d, add a free popular tool (e.g. `chain_gas_price` no paywall) to drive initial install volume |
| Rez email for MCPize account verification needed | High | **This is the only human gate.** MCPize requires email verification to publish. Rez must verify via email link. |
| Stripe Connect prompt during listing creation | Medium | MCPize nudges toward Stripe Connect. The dev.to article confirms it's skippable — look for the subtle "Skip" / "Set up later" option |

### Irreversible actions

| Action | Reversible? | Gate |
|--------|------------|------|
| Create MCPize account | ✅ Yes (delete account) | Rez email |
| Fill out listing form | ✅ Yes (edit before publish) | Autonomous |
| Upload icon | ✅ Yes (replace anytime) | Autonomous |
| Publish listing | ❌ Semi — listed servers can be removed but may be cached | Rez (final button) |

**All prep work in this document is 100% revertible.** The only irreversible atom is clicking Publish, which requires email verification in Rez's inbox.

---

## 12. References

| Source | URL | Relevance |
|--------|-----|-----------|
| MCPize — home page | https://mcpize.com | Marketplace home |
| cipher-x402-mcp (live comparable) | https://cipher-x402-mcp.vercel.app | Proof-of-pattern — x402 MCP server deployed on MCPize |
| cipher-x402-mcp GitHub | https://github.com/cryptomotifs/cipher-x402-mcp | Reference implementation, server.json format |
| DEV.to — Listing on MCPize (x402 bypass) | https://dev.to/sai_93caeceb4f6a4d9969910/listing-on-mcpize-the-official-mcp-registry-while-routing-payments-outside-the-marketplace-how-2al8 | **Primary reference** — exact pattern for discovery-only listing with x402 |
| Godberry Studios — How to Monetize MCP Servers 2026 | https://godberrystudios.com/posts/how-to-monetize-mcp-servers-2026/ | MCPize pricing models, platform economics, revenue data |
| x402-data-api Worker | https://x402-data-api.sigrunner.workers.dev | Our live endpoint + landing page |
| Official MCP Registry | https://registry.modelcontextprotocol.io/v0/servers?search=rezearcher | Our existing listing (server.json v1.2.0) |
| docs/MARKET_ANALYSIS_2026-07-16.md | — | Bazaar demand analysis, pivot context |
| docs/DEMAND_RESEARCH.md | — | 4-source demand research + MCPize channel analysis |
| docs/FIRST_DOLLAR_PLAYBOOK.md | — | Distribution channels, first-dollar strategy |
| docs/DISTRIBUTION_STATUS.md | — | All 5 open distribution PRs status |
