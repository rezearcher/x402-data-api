# mcpHQ/awesome-mcp-servers — directory submission PR #364

**Date:** 2026-10-21
**Lane:** A (demand / discoverability — proven-converting inbound directory shape)
**Lever:** mcphq-directory-pr364 (contacted->replied)
**PR:** https://github.com/mcpHQ/awesome-mcp-servers/pull/364 — OPEN, MERGEABLE, +38/-4

## What & why
Submitted Grey Ridge x402 to **mcpHQ/awesome-mcp-servers** (194★, updated today).
This is a *fresh class* of surface vs. the saturated x402 registries: it is an
**MCP-server directory** with a live site (mcphq.org) and — critically —
**`llms.txt` / `llms-full.txt` generated from `data/servers.json`**, so both human
browsers AND agents discover listed servers. Directory listings are our only proven
converter shape (Haven, ArbiVault both came from in-flight directory/code refs).

Category: `finance-commerce-and-business-apps`. Entry includes the live
`endpoints.streamableHttp` so the directory's checks / agents can reach `/mcp` directly.

## Pre-flight (all green locally, matches their CI)
- `node scripts/validate-data.mjs` → passed (382 servers)
- `generate-readme --check` / `generate-llms --check` → up to date
- `build-site` → built our server page `grey-ridge-x402-market-defi-data`
- check-links: only checks `server.url` (our repo → 200); 405 on `/mcp` GET is allow-listed anyway
- Entry inserted mid-array per their AI-agent CONTRIBUTING note (avoids merge conflicts)

## Live-endpoint evidence (verified this cycle, probe-style)
- `initialize` (clientInfo `awesome-mcp-servers-probe`) → protocolVersion 2025-06-18,
  serverInfo `x402-data-api` 0.1.0, no session-id (stateless)
- `tools/list` → 26 tools (SSE text/event-stream), free previews, no credentials

## Sweep this cycle (nothing else convertible)
- Inbox: Miles/LiquidLogicX replied Oct 20 — "team will run the free preview this week;
  if useful we'll take the itemized run." BALL-IN-COURT, DO NOT re-ping.
- GitHub reply sensor: 61 replies, all NOs (token-safety free-commodity / chain-mismatch)
  or ball-in-court.
- Open PRs (shipyard#34, ampersend#149, BlockRun awesome#142, adexto#5): no maintainer
  activity, all ball-in-court.
- buyer-intent scanner: 0 HOT (113 targets, all seller/ambiguous/other-chain).
- Code-search for our URLs: all handled (Haven/ArbiVault/nastech) or measurers
  (tashan, x402-measure, kato9292929/endpoint census).
- TensorBlock/awesome-mcp-servers (933★) ALREADY lists us (docs/finance--crypto.md).
- AIAnytime/Awesome-MCP-Servers (77★) ALREADY lists us accurately, endpoint healthy.
