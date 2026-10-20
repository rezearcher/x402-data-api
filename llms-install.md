# Grey Ridge Signals — x402 Data & Security MCP: Install Guide for AI Agents

This is a **remote (streamable-HTTP) MCP server**. No install, no API key, no account. Tools are
pay-per-call over the **x402** protocol (USDC on Base mainnet); each paid tool returns an HTTP 402
challenge your agent settles inline. Every data tool has a **free preview** so you can taste the
payload before paying.

## Endpoint
```
https://x402-data-api.sigrunner.workers.dev/mcp
```

## Add to an MCP client (streamable-http)
Claude Desktop / Cline / Cursor `mcp` config:
```json
{
  "mcpServers": {
    "greyridge-x402": {
      "type": "streamable-http",
      "url": "https://x402-data-api.sigrunner.workers.dev/mcp"
    }
  }
}
```

## Paying for calls (x402)
Paid tools return a 402 with an accepts-list (scheme `exact`, network `eip155:8453`, USDC). Settle it
with any x402 client (e.g. the `x402-fetch`/`x402-axios` libraries or a wallet that speaks EIP-3009)
and retry; the data returns in the same request. Prices from **$0.001/call**. No platform cut — payment
goes caller → our wallet on Base.

## What it's for
Agent-native crypto / DeFi / prediction-market data + **MCP security enrichment** (domain tech-stack
fingerprint → CVE → EPSS → CISA-KEV → clear/review/block verdict). Discovery + fee schedule:
`/.well-known/x402`, `/openapi.json`, `/llms.txt`.
