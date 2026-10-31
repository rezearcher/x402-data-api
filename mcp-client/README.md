# @grey-ridge/x402-data-api-mcp

**x402 payment verification and safety for AI agents that pay.** An [MCP](https://modelcontextprotocol.io) server that lets your agent check an x402 endpoint *before* it pays, prove the payment settled *after*, and screen the counterparty wallet — plus Base pre-trade swap safety, token reports, and free MCP-security scanning.

Every price-only x402 checker stops at the pre-payment 402 challenge. This server also reconciles the **on-chain settlement** against what the endpoint advertised, and screens for OFAC-sanctioned / known-scam addresses.

## What it does

**Payment verification**
- `x402_preflight` — before paying, returns **PAY | CAUTION | AVOID** from will-it-settle, safe-to-pay (OFAC/scam address + prompt-injection), price-accuracy (does it charge what it advertises) and delivery-readiness (leaking paywall / output spec) checks.
- `x402_receipt_verify` — after paying, reconciles the on-chain USDC settlement against the endpoint's advertised `payTo` + amount → **SETTLED | UNDERPAID | WRONG_RECIPIENT | NOT_FOUND**.
- `chain_wallet_screen` — flags OFAC-sanctioned and known scam/drainer addresses before you send.

**Base trade safety** — `gate_swap` (GO/HOLD/BLOCK: honeypot, rug, buy/sell-tax, position sizing), `chain_token_report` / `chain_token_security` (SAFE/CAUTION/AVOID for any Base ERC-20).

**MCP security** — `scan_mcp_server` / `scan_mcp_preview`: static tool-poisoning / prompt-injection audit of any MCP server (OWASP LLM01/LLM08).

**Data** — crypto prices, funding rates, DeFi yields + entry verdicts, Polymarket markets, Base JSON-RPC (block, gas, balance, token, tx, wallet).

> Honesty (Claims Law): pre-payment checks are *readiness*, not a post-payment guarantee; a "clear" scan is *not* proof of safety.

The full, always-current tool set is discovered live at connect time via `tools/list` — this client is a thin stdio proxy to the live Worker, so you never run a stale tool list. Every paid tool has a free `_preview` companion.

## Install

### Option A — remote server (zero dependencies, no wallet needed for previews)

Most MCP clients (Claude Desktop, Cursor, Cline) speak streamable-HTTP directly. Point them at the live endpoint:

```json
{
  "mcpServers": {
    "grey-ridge-x402": {
      "type": "streamable-http",
      "url": "https://api.greyridgesignals.ai/mcp"
    }
  }
}
```

### Option B — stdio client with inline x402 wallet auto-pay

Use this when your client is stdio-only, or when you want paid tools to **auto-settle** HTTP 402 from your own wallet:

```bash
npm install -g @grey-ridge/x402-data-api-mcp

# free / preview tools (no wallet)
x402-data-api-mcp

# paid tools auto-settle x402 in USDC on Base
X402_WALLET_PRIVATE_KEY=0x... x402-data-api-mcp
```

The client is a thin live proxy, so the published package always exposes the Worker's current tool set (fetched via `tools/list` at connect time).

## Configuration

Copy `.env.example` to `.env`:

- `WORKER_BASE_URL` — defaults to `https://api.greyridgesignals.ai`
- `X402_WALLET_PRIVATE_KEY` — optional; enables paid-tool auto-settlement. The wallet address is derived from this key.

## Pricing

Keyless. Free preview on every paid route; full verdicts settle inline in USDC on Base via x402 (~$0.001–0.01 per call, network `eip155:8453`). Payment manifest: `https://api.greyridgesignals.ai/.well-known/x402`.

## Architecture

```
┌──────────────┐   stdio   ┌─────────────────────┐   HTTP POST   ┌────────────────────────┐
│  MCP Client  │◄────────►│  x402-data-api-mcp   │─────────────►│  x402-data-api Worker   │
│ (Claude,     │  JSON-RPC │  (stdio proxy)       │     /mcp      │  (Cloudflare Workers)   │
│  Cursor, …)  │           │  + x402 wallet auto- │               │  api.greyridgesignals.ai │
└──────────────┘           │  settlement          │               └────────────────────────┘
                           └─────────────────────┘
```

## Development

```bash
cd mcp-client
npm install
npx tsc                    # compile TS to dist/
node dist/server.js        # run (no wallet)
X402_WALLET_PRIVATE_KEY=0x... node dist/server.js  # with wallet
node test-mcp-client.mjs   # run tests against live production
```

## Provider

Grey Ridge Signals Group LLC · [api.greyridgesignals.ai](https://api.greyridgesignals.ai) · MIT.
