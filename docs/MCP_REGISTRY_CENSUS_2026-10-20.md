# MCP registry remotes census — 2026-10-20

Method: every `streamable-http` remote listed in the official MCP registry (snapshot of 252 entries, 246 unique URLs) was sent to the free `GET /scan/mcp/preview?url=` endpoint of the Grey Ridge scanner. The scan is static analysis of the advertised `tools/list` metadata (descriptions, schemas, hidden unicode); no tool is ever called. Raw rows: `benchmarks/registry_census/raw.jsonl`; reproduce with `scripts/registry_census.sh`.

| measure | count |
|---|---|
| unique remote URLs probed | 246 |
| scanned successfully (tools/list readable without credentials) | 109 (44%) |
| tools scanned | 987 |
| verdict clear / review / block | 108 / 0 / 1 |
| total issues flagged | 4 |
| unreadable without credentials (auth error text) | 45 |
| other fetch failure (403/530, non-JSON, timeout, SSE-only) | 92 |

Reading: of the remotes an unauthenticated client can inspect, 108/109 were clean at scan time; the unscanned majority is credential-gated or non-standard, which is what the paste-mode (`POST /scan/mcp/preview` with your own `tools` array) covers. Scanner accuracy on a hand-built corpus is in `benchmarks/README.md` (in-sample, n=42; not a guarantee). Flagged servers are intentionally not named here; operators can run the preview on their own URL.

## Correction (c67, 2026-10-20)

The one `block` in this census was a **scanner false positive**, not a poisoned server: the rule `never tell ... the user` matched the benign accuracy instruction "Never tell the user a likely_available name is available" in two tool descriptions. Reproduced by fetching that server's `tools/list` and running the analyzer locally. The rule is now narrowed to concealment phrasing (`never tell the user about/that you/of/how you/what you ...`) in `src/index.ts`, and the false-positive sample plus two true-poisoning variants were added to `benchmarks/mcp_scan_corpus.json` (now n=45: local analyzer recall 1.00 / precision 1.00, in-sample). Corrected reading: 109/109 readable remotes were clear; the live endpoint picks up the fix on next deploy. Census poisoning base rate: 0 confirmed.

## Re-run — 2026-10-22 (live `/scan/census`)

Fresh pass over the official registry's remote (`streamable-http`) servers, same static method (advertised `tools/list` metadata only; no tool ever invoked). Figures read from the live `GET /scan/census` snapshot.

| measure | count |
|---|---|
| remote MCP servers probed | 118 |
| reachable / live (tools/list readable unauthenticated) | 65 (≈55%) |
| unreachable (auth-gated, 403/530, SSE-only, timeout) | ~53 (≈45%) |
| tools scanned across live servers | 528 |
| flagged (OWASP LLM01 injection / LLM08 excessive agency) | 0 |
| tools per server | up to 35, avg 8.1 |

Two independent censuses now agree: confirmed MCP tool-poisoning **base rate in the public remote registry = 0** (109/109 clean on 2026-10-20 after the false-positive correction; 65/65 clean on 2026-10-22).

### What the base rate means for the product (strategic reading)

The headline is deliberately honest: the public MCP ecosystem is *not* riddled with overt tool-poisoning today. A point-in-time scan of a registry server almost always returns CLEAR. That has a direct product consequence — **point-in-time scanning has no acute "here is your problem" moment to convert on**, because the real-world hit rate is ~0. The durable, payable value is therefore not *catching* a poisoned server (rare event) but *continuous assurance*: every tool description is attacker-mutable the next time a server updates, so clean today is not clean forever. The case is scanning on every connect and alerting on drift — a recurring attestation, not a one-time catch. This is the data behind why our monitoring plan, not the free one-shot scan, is the product.
