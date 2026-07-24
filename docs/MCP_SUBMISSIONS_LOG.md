# MCP Submissions Log — Grey Ridge Signals x402 Data & Security

**Project:** Grey Ridge Signals Group LLC (x402 Data & Security APIs)  
**MCP Endpoint:** https://x402-data-api.sigrunner.workers.dev/mcp  
**Service Metadata Endpoint:** https://x402-data-api.sigrunner.workers.dev/.well-known/x402  
**Start Date:** 2026-07-17  
**Last Updated:** 2026-07-18  
**Owner:** Rez (matthewjaybowman@gmail.com)

---

## TL;DR — Status

**✅ SUBMITTED (3):** mcp.so (x2), awesome-mcp-servers (punkpeye), Docker MCP Registry  
**⏳ NEEDS YOU (4):** Smithery (API key), Official MCP Registry (npm pkg), appcypher fork, mcpservers.org  
**📋 BROWSER-REQUIRED (3):** PulseMCP, Skiln, Claude Desktop Extensions  
**❌ BLOCKED/N/A (3):** Glama (no GitHub repo), Apify (Actors only), MCPCentral (integration pending)

---

## Summary Table

| Directory | Status | Method | Outcome / Next Step |
|-----------|--------|--------|---------------------|
| mcp.so | ✅ SUBMITTED | GitHub Issue #3211 then #3212 | Auto-index within 48-72h |
| awesome-mcp-servers (punkpeye) | ✅ SUBMITTED | PR #10353 | Awaiting merge |
| Docker MCP Registry | ✅ SUBMITTED | GitHub PR via mcp-submit | Awaiting merge |
| Smithery | ⏳ NEEDS YOU | `smithery mcp publish` CLI | Get key from smithery.ai/account/api-keys → paste here |
| mcpservers.org | ⏳ NEEDS YOU | Browser form | https://mcpservers.org/submit |
| awesome-mcp-servers (appcypher) | ⏳ NEEDS YOU | GitHub PR | Fork appcypher/awesome-mcp-servers under rezearcher |
| Official MCP Registry | ⏳ NEEDS YOU | mcp-publisher CLI | Publish npm/PyPI package first |
| PulseMCP | 📋 BROWSER-REQ | Web form (Cloudflare blocks API) | https://pulsemcp.com/submit |
| Skiln | 📋 BROWSER-REQ | Web form — React SPA (Next.js) | https://skiln.co/submit — basic listing free, $29 for Verified |
| Claude Desktop Extensions | 📋 BROWSER-REQ | Google Form | https://claude.ai |
| Glama | ❌ BLOCKED | GitHub-repo-based only | No public repo = no auto-detection |
| Apify Store | ❌ N/A | N/A | Apify Actors only, not HTTP MCP servers |
| MCPCentral | ❌ PENDING | API integration | mcp-submit integration not yet implemented |

---

## Submission Details

### ✅ mcp.so — Issue #3211
- **Date:** 2026-07-18 03:36 UTC
- **Method:** Automated via `mcp-submit` (GitHub Issue API)
- **URL:** https://github.com/chatmcp/mcpso/issues/3211
- **Status:** Open — awaiting auto-index (48-72h)
- **Note:** This is the 2nd issue (first was #3190 filed manually earlier)

### ✅ awesome-mcp-servers (punkpeye) — PR #10353
- **Date:** 2026-07-18 03:36 UTC
- **Method:** Automated via `mcp-submit` (fork: rezearcher/awesome-mcp-servers → PR)
- **URL:** https://github.com/punkpeye/awesome-mcp-servers/pull/10353
- **Status:** Open — awaiting review/merge
- **Branch:** `add-com-sigrunner-greyridge-x402-data-security`

### ✅ Docker MCP Registry
- **Date:** 2026-07-18
- **Method:** Automated via `mcp-submit` (GitHub PR)
- **URL:** https://github.com/docker/mcp-registry (PR created)
- **Status:** Awaiting merge

### ⏳ Smithery — Needs API Key
- **Method:** `smithery mcp publish https://x402-data-api.sigrunner.workers.dev/mcp -n x402-data-security`
- **Blocker:** Requires API key from https://smithery.ai/account/api-keys
- **Action for Rez:** Visit that URL → generate API key → paste here to complete submission
- **Alternative:** Use https://smithery.ai/docs/build/publish web form (Bring Your Own Hosting)

### ⏳ Official MCP Registry — Needs Package
- **Method:** `mcp-publisher` CLI from `@modelcontextprotocol/mcp-publisher`
- **Requirement:** Must publish npm or PyPI package first
- **Action for Rez:** Publish the MCP server as npm package → then run `npx @modelcontextprotocol/mcp-publisher register`
- **Docs:** https://modelcontextprotocol.io/registry/quickstart

### ⏳ awesome-mcp-servers (appcypher) — Needs Fork
- **Blocker:** No fork exists under `rezearcher/` for `appcypher/awesome-mcp-servers`
- **Action:** Fork appcypher/awesome-mcp-servers under rezearcher GitHub account → re-run mcp-submit

### 📋 Manual Submissions (Web Forms)

These require opening a browser and filling a form:

| Directory | URL | Fields |
|-----------|-----|--------|
| PulseMCP | https://pulsemcp.com/submit | Name, URL, Description |
| mcpservers.org | https://mcpservers.org/submit | Name, URL, Description, Tags |
| Skiln | https://skiln.co/submit | Name, Type=MCP Server, URL, Description, Tags |

**Recommended form values:**
```
Name: Grey Ridge Signals x402 Data & Security
URL: https://x402-data-api.sigrunner.workers.dev/mcp
Description: Agent-native prediction-market & crypto data, plus MCP security audits. Pay-per-call over x402 (USDC on Base). 21 tools covering prediction markets, crypto prices, DeFi yields, onchain RPC, token security analysis, and MCP server vulnerability scanning.
Tags: x402, prediction-markets, crypto, defi, security, onchain, base, usdc
Author: Grey Ridge Signals Group LLC
```

---

## Tooling Notes

### `mcp-submit` CLI (by Jordan Lyall)
- Installed via `npx mcp-submit` — submits to all major directories in one command
- Detects HTTP remote endpoints via `server.json` → `remotes[0].url`
- Supports: Official Registry (pending), Smithery (needs API key), MCPCentral (pending), mcp.so, awesome-mcp-servers (x2), Docker MCP Registry, PulseMCP (opens browser), mcpservers.org (opens browser), Claude Desktop (opens browser)
- Uses `gh auth token` for GitHub authentication automatically

### Server Metadata File
- `/tmp/x402-submit/server.json` — contains correct format for mcp-submit
- Format uses `remotes` array (not `transport` field)

---

## Verification & Next Steps

### Immediate actions for Rez:
1. **Get Smithery API key** at https://smithery.ai/account/api-keys (or use web form)
2. **Fork appcypher/awesome-mcp-servers** under rezearcher account
3. **Submit 3 manual web forms:** PulseMCP, mcpservers.org, Skiln
4. **Publish npm/PyPI package** if interested in Official MCP Registry

### Verification checks (48h after submissions):
- mcp.so: Search for "x402" or "Grey Ridge Signals"
- awesome-mcp-servers: Check PR #10353 status
- Docker MCP Registry: Search for x402-data-security
- Smithery: Search for "Grey Ridge Signals" or "x402"

---

## Previous Submissions

| Date | Directory | Method | Result |
|------|-----------|--------|--------|
| 2026-07-17 | mcp.so | Manual GitHub Issue #3190 | Awaiting auto-index |
| 2026-07-18 | mcp.so | Automated via mcp-submit | Issue #3211 |
| 2026-07-18 | awesome-mcp-servers (punkpeye) | Automated via mcp-submit | PR #10353 |
| 2026-07-18 | Docker MCP Registry | Automated via mcp-submit | PR created |
