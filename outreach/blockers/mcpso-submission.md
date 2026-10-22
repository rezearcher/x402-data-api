# Rez atom — submit Grey Ridge to mcp.so (2 minutes, free)

**Why this one:** mcp.so is the most-trafficked **human-browsed** MCP discovery site (per-server
pages, install configs, tool lists). It is a different class from the ~25 GitHub "awesome-list" PRs
we have open (all maintainer-ball-in-court, 0 merged, agent-discovery desert). A **competitor x402
data store — "Scrapling x402 Data Store" — is already listed there as a remote Streamable-HTTP
server**, so the audience fit is confirmed: x402/MCP buyers browse mcp.so. We are **not** listed
(search `greyridge` on mcp.so = 0 results, verified 2026-10-22).

Submission is a web form that requires a sign-in, so it needs your account — everything else is
prepared below. The free path exists ("listings go live after review"); do **not** pay the $39
featured fee.

## Steps
1. Go to **https://mcp.so/submit** and sign in (GitHub login works).
2. Choose the **"Remote Server"** tab (not "MCP Server" — ours is remote Streamable-HTTP, not an npm repo).
3. Paste the fields below. If it asks only for a URL, paste the server URL and let it auto-fetch,
   then review the name/description before submitting.

## Paste-ready fields
- **Server URL (Streamable HTTP):** `https://x402-data-api.sigrunner.workers.dev/mcp`
  - Use the `sigrunner.workers.dev` host, **not** `api.greyridgesignals.ai` — the custom domain has
    Cloudflare Bot Fight Mode that can 403 a datacenter review-probe and get us mis-flagged as
    auth-gated. The workers.dev host answers `initialize`/`tools/list` anonymously (HTTP 200, 22 tools,
    verified 2026-10-22). Same Worker, same tools.
- **Name:** `Grey Ridge Signals`
- **Auth:** none / no API key (pay-per-call via x402, USDC on Base; free previews)
- **Homepage / Docs:** `https://api.greyridgesignals.ai` (OpenAPI at `/openapi.json`, discovery at `/.well-known/x402`)
- **Description (paste verbatim):**
  > Hosted remote MCP server (Streamable HTTP, no API key). On-chain safety + market data for Base:
  > ERC-20 honeypot / sellability / owner-mint-pause checks, a GO/HOLD/BLOCK pre-trade swap gate,
  > MCP tool-poisoning & prompt-injection scanning (OWASP LLM01/LLM08), plus crypto prices, funding,
  > DeFi yields and Polymarket reads. Pay-per-call in USDC via x402; free previews on every tool.
- **Category:** Finance / Crypto / Security (pick the closest the form offers)
- **Tags:** `x402`, `base`, `token-safety`, `mcp-security`, `defi`, `market-data`

## After it is live
Reply here or drop the live mcp.so URL in `outreach/warm_leads.json` notes so a future cycle can
cross-link it from `/scan/directory` and the warm-lead threads. No further action from you.
