I pulled every remote streamable-http server from registry.modelcontextprotocol.io and ran a static scan on each one's advertised `tools/list`: descriptions, JSON schemas, hidden unicode. No tool is ever called. This is the metadata an LLM trusts before it acts.

Pooled across two snapshots (364 servers probed):

- **174 (48%) answered `tools/list` with no credentials.** Their full tool surface is readable by any anonymous client.
- **0 confirmed tool poisoning** in that population (0 of 174). One early block turned out to be my own rule misfiring on a benign accuracy instruction, so I narrowed the rule and added it to the test corpus.
- In a follow-up re-probe of 93 servers that still answered, 75 (about 81%) advertised only read-only lookup tools, which is what you'd expect from a public registry.
- The minority worth a look: a secrets manager, an API-key console that issues live keys, an open-banking server, and an identity server with `delete_account`, all enumerable anonymously. A readable tool list doesn't prove those execute without auth, but it is the surface your agent reads.

My takeaway: a one-shot scan almost always comes back clear, so the value isn't catching a poisoned server (rare). It's that every tool description can change on the next deploy, so "clean" has a shelf life. That argues for scanning on connect and alerting on drift.

You can scan your own server free, no account:
`curl "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"`
Private or stdio server? POST your `tools/list` instead; nothing leaves your machine. Method and the reproduce script are in the repo (github.com/rezearcher/x402-data-api, scripts/registry_census.sh).

Curious what people here think about scan-on-connect versus registry-level attestation.

I'm the author, Grey Ridge.
