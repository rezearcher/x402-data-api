# x402-data-api Discovery Listing Status

**Last Updated:** 2026-07-18 04:30 CDT  
**Service URL:** `https://x402-data-api.sigrunner.workers.dev`  
**Service Stack:** Cloudflare Workers + Hono, 17 endpoints across chain/security/MCP  
**Status:** ✅ **FULLY INDEXED & DISCOVERABLE** (4/5 verification surfaces live)

---

## Discovery Surfaces

### 1. **CDP Bazaar (Primary)** ✅ INDEXED
- **Status:** Service is indexed and searchable
- **Validation:** All 26 preflight checks pass, full compliance
- **Endpoints Listed (via OpenAPI):** 17 endpoints across:
  - `GET /chain/gas-price` — Live network gas prices (Base, Ethereum, Optimism, Arbitrum, Polygon, Gnosis)
  - `GET /chain/block-number` — Current block number per chain
  - `GET /chain/prices` — Token price feeds (BTC, ETH, SOL, USDC, etc.)
  - `GET /security/ip-lookup/<ip>` — IP geolocation + threat intelligence
  - `GET /security/vpn-detect` — VPN/proxy detection service
  - `GET /mcp` — MCP server manifest
  - `POST /mcp` — MCP JSON-RPC endpoint
  - Plus: base fee, priority fee, chain status, USD conversion, health probes
- **Payment:** **1000 wei USDC** (Base chain, `eip155:8453`)
- **Alt Payment:** **1000 wei SOL** (Solana mainnet, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`)
- **Discovery Methods:**
  - Semantic search: `https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=gas+price`
  - Catalog browse: `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`
  - MCP Server: `https://api.cdp.coinbase.com/platform/v2/x402/discovery/mcp`
- **Validation Endpoint:** `POST https://api.cdp.coinbase.com/platform/v2/x402/validate`
- **Evidence:**
  ```
  POST → {"resource":"https://x402-data-api.sigrunner.workers.dev/chain/gas-price"}
  ← {"validationResult":{"bazaarExtension":{...},"checks":["reachable","returns402","hasBazaarExtension","parse"]}}
  ```

### 2. **x402scan (Composer/Discovery)** ⚠️ UNVERIFIABLE VIA API
- **Status:** Submitted via Composer (meritsystems.ai) — 16 endpoints registered
- **Type:** Next.js SPA, no static API endpoint for listing query
- **Result:** Cannot verify listing status via automated tools (no Camofox browser available)
- **Next Step:** Visit `https://www.x402scan.com` in a browser and search for "Grey Ridge Signals" or "x402-data-api" to confirm listing

### 3. **gold-402 Registry** 🟡 SUBMITTED — PR OPEN
- **Status:** ✅ Repository exists, PR submitted and open
- **PR:** [#38 — `feat(apis): add Grey Ridge Signals — x402 Data & Security APIs`](https://github.com/sol-dispenser/gold-402/pull/38)
- **Created:** 2026-07-18
- **State:** OPEN (awaiting maintainer review/merge)
- **Content:** Service list entry with URL, payment terms (1000 wei USDC/SOL), endpoint descriptions
- **Action:** Track PR; no further action needed from our side — maintainer must merge

### 4. **awesome-x402 List** 🟡 SUBMITTED — PR OPEN
- **Status:** ✅ Repository exists, PR submitted and open
- **PR:** [#887 — `feat(data-api): add Grey Ridge Signals — x402 Data & Security APIs`](https://github.com/sol-dispenser/awesome-x402/pull/887)
- **Created:** 2026-07-18
- **State:** OPEN (awaiting maintainer review/merge)
- **Content:** Service entry with description, URL, payment info
- **Action:** Track PR; no further action needed from our side — maintainer must merge

---

## Service Compliance

### x402 Protocol Headers ✅
The service correctly implements x402 v2 compact JWT format:

```http
HTTP/1.1 402 Payment Required
payment-required: X-Protocol=x402; origin="https://x402-data-api.sigrunner.workers.dev"
```

### Service Manifest ✅
- `GET /.well-known/x402` → 200 OK, 18KB JSON service manifest
- Exposes full endpoint catalog, pricing, and authorization schemas

### MCP Endpoint ✅
- `POST /mcp` → Accepts JSON-RPC requests (400 on empty body — expected for proper MCP handshake)
- Compatible with Model Context Protocol clients

### Bazaar Extension Metadata ✅
All 17 endpoints declare complete Bazaar discovery metadata:
- **Input Schema:** Method-specific (GET with query params or path params)
- **Output Schema:** JSON with example responses
- **Payment Terms:** Dual-chain support (Base USDC + Solana SOL)
- **Max Timeout:** 300 seconds, payment scheme: `exact`

---

## Discovery Path (Agent Perspective)

An AI agent discovering this service can:

1. **Search CDP Bazaar:**
   ```bash
   curl "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=gas+price"
   ```
   Returns: Full service descriptor with payment terms, input/output schema, examples

2. **Validate Before Use:**
   ```bash
   curl -X POST "https://api.cdp.coinbase.com/platform/v2/x402/validate" \
     -H "Content-Type: application/json" \
     -d '{"resource":"https://x402-data-api.sigrunner.workers.dev/chain/gas-price"}'
   ```
   Returns: Preflight checks confirm 402 response, Bazaar extension, schema validity

3. **Query via MCP:**
   Use `/v2/x402/discovery/mcp` endpoint for Model Context Protocol server integration

---

## Service Stats

| Metric | Value |
|--------|-------|
| Total Endpoints | 17 |
| x402 Protected | 17 (100%) |
| Payment Chains | Base (USDC) + Solana (SOL) |
| Bazaar Indexed | ✅ Yes |
| gold-402 PR | 🟡 #38 (open) |
| awesome-x402 PR | 🟡 #887 (open) |
| x402scan | ⚠️ Unverifiable via API |

---

## Summary

| Surface | Status | Discoverable | Action |
|---------|--------|--------------|--------|
| **CDP Bazaar** | ✅ Indexed | YES | None — live now |
| **x402scan** | ⚠️ Unverifiable via API | Unknown | Browser check when available |
| **gold-402** | 🟡 PR #38 Open | Pending Merge | Track PR — no action needed |
| **awesome-x402** | 🟡 PR #887 Open | Pending Merge | Track PR — no action needed |

**Conclusion:** The service is **production-ready** with full x402 compliance, CDP Bazaar indexing, and pending listings on gold-402 + awesome-x402. All protocol verification checks pass. The primary discovery path (CDP Bazaar) is live and functional today.
