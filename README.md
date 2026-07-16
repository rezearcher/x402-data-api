# MCP Security Scanner

**Audit any MCP server for tool-poisoning, prompt-injection, and data-exfiltration risk
(OWASP LLM01 / LLM08) — before you connect an agent to it.**

Live, agent-native, pay-per-scan over the [x402 payment protocol](https://x402.org) on Base
mainnet. No account, no API key, no subscription — an agent pays $0.05 USDC per scan inline
and gets the report back in the same call.

**Endpoint:** `https://x402-data-api.sigrunner.workers.dev/mcp`
**MCP Registry:** `io.github.rezearcher/tech-risk`

---

## Why

Agents are wiring themselves to third-party MCP servers at runtime. A malicious or careless
server can hide instructions in a tool description (tool-poisoning), smuggle a prompt-injection
payload through a tool's output, or quietly exfiltrate data. These are the top of the
[OWASP LLM Top-10](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
(LLM01 prompt-injection, LLM08 excessive agency / supply-chain). There is no clean way for an
agent to check *the server it is about to trust* on its own.

This tool is that check. Point it at an MCP server URL; it enumerates the server's tools and
statically analyzes every tool schema for known poisoning / injection / exfiltration patterns,
and returns a scored, itemized report.

## Tools

Discovery (`tools/list`) is **free** so agents can find the scanner. Two scan tools:

| Tool | Price | Returns |
|------|-------|---------|
| `scan_mcp_preview` | **free** | Tool count, issue count, severity breakdown, risk score, one-line summary |
| `scan_mcp_server` | **$0.05 USDC** | The full itemized report: every flagged tool, the exact pattern matched, severity, and remediation |

The free preview tells you *whether* a server is risky and *how many* issues. The paid scan
tells you *which* tool is poisoned and *how* — the detail you need to actually act.

Both take a single argument:

```json
{ "url": "https://target-mcp-server.example.com/mcp" }
```

## Call it

```bash
BASE=https://x402-data-api.sigrunner.workers.dev

# discover (free)
curl -s -X POST $BASE/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# free preview — counts + risk score, no payment
curl -s -X POST $BASE/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scan_mcp_preview","arguments":{"url":"https://mcp.deepwiki.com/mcp"}}}'

# full scan — returns HTTP 402 with an x402 payment-required challenge until you attach payment
curl -i -X POST $BASE/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"scan_mcp_server","arguments":{"url":"https://mcp.deepwiki.com/mcp"}}}'
```

Any x402-capable client (e.g. the [`x402`](https://www.npmjs.com/package/x402) libraries)
handles the 402 → sign → retry automatically. Payment settles through the non-custodial
[xpay](https://facilitator.xpay.sh) facilitator; no Coinbase/CDP account required.

## What it detects

Static analysis of each advertised tool's name, description, and schema for:

- **Tool poisoning** — hidden/imperative instructions embedded in a tool description that try
  to steer the calling agent.
- **Prompt injection** — injection markers, role-override phrasing, and instruction smuggling.
- **Data exfiltration** — tool shapes that solicit secrets, credentials, or full context and
  ship them to an external sink.
- **Invisible-unicode payloads** — tag-block / zero-width characters used to hide instructions
  from a human reviewer.
- **Dangerous capability** — over-broad tool surface (shell, file, network) advertised without
  constraint.

Each hit carries a severity; the report rolls them into a 0–100 risk score.

## Also included

Two enrichment tools on the same endpoint (tech-stack → CVE/EPSS/CISA-KEV risk, and domain
firmographics) built on free/keyless sources (NVD, FIRST EPSS, CISA KEV, crt.sh, RDAP,
Cloudflare DoH).

## How it runs

A single [Cloudflare Worker](./src/index.ts) implements the MCP endpoint and the method-aware
x402 gate: `initialize` and `tools/list` are free; `tools/call` on a paid tool returns HTTP 402
with a well-formed `payment-required` challenge until a valid `X-PAYMENT` proof is attached.
Scan-target input is SSRF-guarded (internal/loopback/metadata addresses rejected).

## License

MIT — see [LICENSE](./LICENSE).
