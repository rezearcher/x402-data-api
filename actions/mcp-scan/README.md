# MCP tool-poisoning scan (GitHub Action)

Scan an MCP server's advertised tools for tool poisoning, hidden unicode and prompt injection before you ship or connect to it. The free preview returns a verdict (`clear` / `review` / `block`) and risk score; itemized findings with evidence and OWASP mapping are a paid x402 call (USDC on Base, $0.05).

```yaml
- uses: rezearcher/x402-data-api/actions/mcp-scan@main
  with:
    url: https://your-host/mcp        # or tools-file: tools.json for stdio/private servers
    fail-on: block                    # block | review | never
```

Static analysis of tool metadata only; it never calls your tools. Accuracy is reported with sample sizes in [`benchmarks/`](../../benchmarks) (small hand-built corpus, not a guarantee).

Grey Ridge Signals Group LLC, contact@greyridgesignals.ai.
