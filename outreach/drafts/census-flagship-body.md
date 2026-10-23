We probed every remote server in the official Model Context Protocol registry and asked each one a single question with no credentials attached: will you hand me your full tool list? About half said yes. Almost none were poisoned. Both facts are true at once, and together they decide what a real MCP security product should actually be.

## The measurement

Each `streamable-http` remote in `registry.modelcontextprotocol.io` was sent to the free `GET /scan/mcp/preview?url=` endpoint. That endpoint does static analysis of the advertised `tools/list` metadata only: tool names, descriptions, JSON schemas, hidden unicode. No tool is ever invoked. We ran it twice, three weeks apart, and pooled the results.

| snapshot | remotes probed | readable, no credentials | share | tools scanned | clean | confirmed poisoning |
|---|---|---|---|---|---|---|
| 2026-10-20 | 246 | 109 | 44% | 987 | 109 / 109 | 0 |
| 2026-10-22 | 118 | 65 | 55% | 528 | 65 / 65 | 0 |
| pooled | 364 | 174 | 48% | 1,515 | 174 / 174 | 0 |

The first snapshot is reproducible row by row from `benchmarks/registry_census/raw.jsonl`: 246 rows, 109 of which answered `tools/list` and returned a verdict, 987 tools scanned across them. The servers that did not answer were credential-gated, SSE-only, or returned a 403, a 530, or a timeout. Roughly the other half.

## What "readable with no credentials" does and does not mean

It is not a verdict of insecure. Plenty of MCP servers are meant to be public: read-only data, open catalogues, search endpoints. The narrower and firmer point is this. For about half the registry, the complete tool surface an agent will read and trust before it calls anything is inspectable by anyone. An LLM reads those descriptions and schemas and acts on them. That is also the exact surface a prompt-injection or tool-poisoning attack lives in, and nothing about it is fixed between one deploy and the next.

## The number most coverage gets wrong

Confirmed tool-poisoning across the readable population is zero. Not low. Zero of 174. The public MCP ecosystem is wide open to inspection and is not, today, riddled with overt poisoning.

We want to be honest about one blemish in the raw data, because it changes how you should read the scanner itself. The first snapshot threw a single `block`. It was a false positive: a rule matching concealment phrasing ("never tell the user...") fired on a benign accuracy instruction. We reproduced it locally, narrowed the rule to genuine concealment patterns, and added both the benign sample and two real poisoning variants to the test corpus. Corrected, all 174 readable remotes across both snapshots read clean. A precision bug caught and fixed in public beats a precision bug you never hear about.

## Why this shapes the product and not the pitch

If a point-in-time scan of a registry server almost always returns clean, then one-shot scanning has no acute "here is your emergency" moment to sell. That is the honest reading of the data, and it kills the find-a-vuln-then-sell motion.

The durable value is the opposite shape. Every tool description is attacker-mutable the next time a server ships. Clean today is not clean forever. The case worth paying for is continuous assurance: scan on every connect, alert on drift, treat each deploy as a fresh surface. A recurring attestation, not a one-time catch. The servers that make that worth it are the sensitive minority whose advertised surface describes money movement, credential issuance, or destructive actions. We pulled that minority apart in a separate writeup on the credential surface.

## Check your own server, free, no account

```bash
curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"
# behind auth or stdio-only? POST your own tools/list, nothing leaves your machine:
curl -s -X POST https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview \
  -H 'content-type: application/json' -d '{"tools":[...]}'
```

The preview is free and returns counts, severity, risk score, and a verdict of clear, review, or block. Itemized findings with evidence and OWASP LLM01/LLM08 mapping are the paid `/scan/mcp` call ($0.05, x402 on Base, no account). Continuous drift monitoring with alert-on-change is $9.99/mo. Reach us at contact@greyridgesignals.ai.
