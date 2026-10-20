I ran our free MCP tool-poisoning scanner against your public endpoint (https://api.gigsoul.com/mcp) as a courtesy — result: **clear**, 30 tools scanned, 0 issues (no hidden-instruction / injection / exfil patterns in tool descriptions or schemas).

```bash
curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://api.gigsoul.com/mcp"
```

Since GigSoul sells 23 pay-per-call tools to agents, a "scanned clean" signal is something buyers/agent directories increasingly ask for. The full itemized report is `/scan/mcp` ($0.05 USDC via x402 on Base); the preview above is free and needs no wallet. Happy to add a verifiable badge for your README if useful. No reply needed — just sharing the result.
