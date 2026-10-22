# MCP tool-poisoning scan (GitHub Action)

Scan an MCP server's advertised tools for tool poisoning, hidden unicode and prompt injection before you ship or connect to it. The free preview returns a verdict (`clear` / `review` / `block`) and risk score; itemized findings with evidence and OWASP mapping are a paid x402 call (USDC on Base, $0.05).

```yaml
- uses: rezearcher/x402-data-api/actions/mcp-scan@main
  with:
    url: https://your-host/mcp        # or tools-file: tools.json for stdio/private servers
    fail-on: block                    # block | review | never
```

## Submitting to the Claude Connector Directory?

Anthropic runs a **mandatory** automated security/policy review on every connector submitted to the Claude Connector Directory, and the queue runs ~20 days — a rejection is expensive. Set `directory: true` to also check your tools against Anthropic's [published review criteria](https://claude.com/docs/connectors/building/review-criteria) **before** you submit, every release:

```yaml
- uses: rezearcher/x402-data-api/actions/mcp-scan@main
  with:
    tools-file: tools.json
    directory: true                   # also report Claude Directory readiness
```

The free teaser reports `directory-ready` (true/false) and `directory-blockers` (count). The itemized blocker list and remediation are a paid x402 call (`POST /scan/mcp {"directory":true}`, zero egress, $0.05 USDC on Base). This checks the *published* criteria only — it does not reproduce Anthropic's private scan and does not check privacy policy, OAuth 2.0 config, or DNS ownership.

Static analysis of tool metadata only; it never calls your tools. Accuracy is reported with sample sizes in [`benchmarks/`](../../benchmarks) (small hand-built corpus, not a guarantee).

Grey Ridge Signals Group LLC, contact@greyridgesignals.ai.
