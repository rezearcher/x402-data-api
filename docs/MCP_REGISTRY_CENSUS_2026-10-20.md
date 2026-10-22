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

## What's behind the open tool surface — a second cut

A follow-up pass re-queried `tools/list` on every server from the first snapshot that had answered unauthenticated, to look past the *count* of readable servers and at *what* they expose. Of the 109, **93 re-answered on 2026-10-22** (the other 16 had since churned, gone credential-gated, or returned errors), advertising 833 tools in total.

**The readable registry skews benign-public.** About **four in five of the re-probed servers (75 of 93) advertise only read-only lookup tools** — search, `get_*`, `list_*`, directory and catalogue endpoints. That is the expected shape of a public registry and it is consistent with the 0% poisoning rate: most servers that answer anonymously are *meant* to.

**But a real minority expose a sensitive tool surface to anonymous callers.** A high-precision pass for state-changing or credential-scoped tools flagged a handful of servers whose advertised surface — the names, descriptions and JSON schemas any anonymous client can read before trusting them — includes operations like these (verified live, quoting each server's own tool descriptions):

- **A secrets manager** advertises `request_secret`, `get_secret_link` ("answer *where is my Acme password?* with somewhere to go") and `add_connection` (sign-in links for third-party sites).
- **An API-key console** advertises `create_api_key` (issues `…_live_…` keys with scopes), `revoke_api_key` and `connect_sportsbook` account-linking.
- **An open-banking server** advertises `open_banking_transactions` ("bank account balances and transaction history via PSD2 Open Banking, 300+ UK and European banks"), `bank_accounts` and `stripe_payment_records`.
- **A social/identity server** advertises `delete_account` ("permanently delete the identity belonging to this credential").

A crucial, honest boundary: a readable `tools/list` means the **surface** is anonymous — anyone can enumerate that a server offers banking, secret-vault, key-issuance or account-deletion capabilities and read the exact schema an LLM will act on. It does **not** prove those actions execute without a credential (most are scoped to "this account"). The exposure is recon and prompt-injection surface, not proof of unauthenticated execution. That is still the live risk: the surface is attacker-*visible* and attacker-*mutable* on every deploy.

This is what sharpens the product. The 81% read-only majority rarely needs more than a point-in-time CLEAR. The servers that matter are this sensitive minority — where an open, drifting tool surface describing money movement, credentials or destructive actions is exactly the thing worth watching on every connect. Method and the per-server matches are reproducible from `scripts/census_capability_cut.py`.


## Check your own MCP server (free, no account)

```bash
curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"
# behind auth or stdio-only — POST your own tools/list, nothing leaves your machine:
curl -s -X POST https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview \
  -H 'content-type: application/json' -d '{"tools":[...]}'
```

Itemized findings with evidence and OWASP LLM01/LLM08 mapping: paid `/scan/mcp` ($0.05, x402 on Base). Continuous drift monitoring with alert-on-change: $9.99/mo. Contact: contact@greyridgesignals.ai

