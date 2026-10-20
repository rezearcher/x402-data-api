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
