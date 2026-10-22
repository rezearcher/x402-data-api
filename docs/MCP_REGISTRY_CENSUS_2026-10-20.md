# The MCP exposure census: ~half of public MCP servers expose their full tool list with no authentication

**Key finding.** Across two snapshots of the official MCP registry (`registry.modelcontextprotocol.io`), **174 of 364 remote servers probed — 48%, and between 44% and 55% in any single pass — answered a `tools/list` request with no credentials at all**, handing their complete tool surface (every tool name, description and JSON schema) to any anonymous client. That metadata is exactly what an LLM reads before it calls anything, so it is also the prompt-injection / tool-poisoning attack surface — and it is attacker-mutable on every server update.

The second finding is the one most coverage gets wrong: **confirmed tool-poisoning in that readable population is 0% (0 of 174).** The public MCP ecosystem is wide open to inspection but is *not*, today, riddled with overt poisoning. Both facts matter, and they point at the same product.

Method: each `streamable-http` remote in the registry was sent to the free `GET /scan/mcp/preview?url=` endpoint of the Grey Ridge scanner — static analysis of the advertised `tools/list` metadata (descriptions, schemas, hidden unicode) only; no tool is ever invoked. Snapshot 1 raw rows: `benchmarks/registry_census/raw.jsonl`; reproduce with `scripts/registry_census.sh`. Figures are measured, not modelled (Claims Law).

| snapshot | remotes probed | readable with **no credentials** | share | tools scanned | clean verdict | confirmed poisoning |
|---|---|---|---|---|---|---|
| 2026-10-20 | 246 | 109 | 44% | 987 | 109 / 109 | 0 |
| 2026-10-22 | 118 | 65 | 55% | 528 | 65 / 65 | 0 |
| **pooled** | **364** | **174** | **48%** | **1,515** | **174 / 174** | **0 (0.00%)** |

The servers that did *not* answer were credential-gated, SSE-only, or returned 403/530/timeout — roughly the other half. "Readable with no credentials" is not itself a verdict of *insecure*: many MCP servers are intentionally public (read-only data, open tools). The point is narrower and firmer — for about half the registry, the full tool surface an agent will trust is inspectable by anyone, and nothing about that surface is fixed between updates.

## What the two numbers mean together

A point-in-time scan of a registry server almost always returns **CLEAR** — the real-world poisoning hit rate is ~0. So one-shot scanning has no acute "here is your problem" moment to sell. The durable, payable value is not *catching* a poisoned server (a rare event) but *continuous assurance*: every tool description is attacker-mutable the next time a server ships, so clean today is not clean forever. The case is scanning on every connect and alerting on drift — a recurring attestation, not a one-time catch. That is why the product is the monitoring plan, not the free one-shot scan.

## Scanner accuracy (honest bounds)

The one `block` in the first snapshot was a scanner **false positive** — the rule `never tell ... the user` matched a benign accuracy instruction ("Never tell the user a likely_available name is available"). Reproduced locally, the rule was narrowed to concealment phrasing, and the sample plus two true-poisoning variants were added to the corpus (now n=45: local analyzer recall 1.00 / precision 1.00, **in-sample — not a guarantee on unseen servers**). Corrected reading: 174/174 readable remotes clear across both snapshots.

## Check your own MCP server (free, no account)

```bash
curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"
# behind auth or stdio-only — POST your own tools/list, nothing leaves your machine:
curl -s -X POST https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview \
  -H 'content-type: application/json' -d '{"tools":[...]}'
```

Itemized findings with evidence and OWASP LLM01/LLM08 mapping: paid `/scan/mcp` ($0.05, x402 on Base). Continuous drift monitoring with alert-on-change: $9.99/mo. Contact: contact@greyridgesignals.ai
