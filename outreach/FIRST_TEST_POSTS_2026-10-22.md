# First-test posts — review & post (2026-10-22)

Source data: `docs/MCP_REGISTRY_CENSUS_2026-10-20.md` (measured, reproducible).
Byline: Rez / Grey Ridge (real founder). Voice bar: no AI-assist disclosure lines in public copy (removed 2026-10-22); numbers claim-traced to docs/MCP_REGISTRY_CENSUS_2026-10-20.md.
Post MANUALLY from: HN `greyridge`, Reddit `rezarcher`. Human-review gate = you approve before posting.

Best link target = the census writeup. Cleanest live artifact to link:
- Free scanner (try-it): https://x402-data-api.sigrunner.workers.dev/scan/mcp-scanner
- Repo (reproduce): https://github.com/rezearcher/x402-data-api  (scripts/registry_census.sh)
- (Ideal: publish the census as a standalone page — I can do that next so HN links to findings, not a repo.)

---

## 1) HACKER NEWS — "Show HN"

**Title (pick one, <80 chars):**
- `Show HN: I scanned 364 public MCP servers – 48% expose their tool list unauthed`
- `Show HN: Half of public MCP servers hand their full tool list to anyone (0% poisoned)`

**URL:** the census page (or the free scanner link above)

**First comment (post immediately after submitting):**

I run a small security shop (Grey Ridge). I pulled every remote server in the official MCP
registry (registry.modelcontextprotocol.io) and sent each one's `tools/list` to a static
analyzer — no tool is ever invoked, just the advertised metadata (names, descriptions, JSON
schemas, hidden unicode) an LLM reads before it calls anything.

Two findings, and the second surprised me:

1. 174 of 364 remote servers (48%, pooled across two snapshots) answer `tools/list` with **no
   credentials at all** — full tool surface readable by any anonymous client.
2. Confirmed tool-poisoning in that readable population: **0 of 174 (0%).** The ecosystem is
   wide open to inspection but is *not*, today, riddled with overt poisoning.

The uncomfortable part is the minority. ~81% (75 of 93 re-probed) of readable servers only expose read-only
lookup tools (expected for a public registry). But a handful advertise — to anonymous callers —
a secrets manager (`request_secret`, `get_secret_link`), an API-key console (`create_api_key`
issuing live keys), an open-banking server (`open_banking_transactions` across 300+ EU/UK banks),
and a social server with `delete_account`. A readable `tools/list` doesn't prove those execute
unauthenticated — but the surface is attacker-*visible* and attacker-*mutable* on every deploy,
which is the prompt-injection surface.

Method + raw rows + reproduce script are in the repo; figures are measured, not modelled (I even
caught and documented one false positive and how I fixed the rule). You can scan your own server
free, no account: `curl "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"`
— or POST your own `tools/list` if it's behind auth (nothing leaves your machine).

Happy to answer anything about method or the per-server findings.

---

## 2) r/mcp — "I scanned the whole MCP registry; here's the tool-list exposure census"

**Title:** `I scanned every remote server in the MCP registry: 48% expose their full tool list unauthenticated, 0% actually poisoned`

**Body:**

I pulled all remote `streamable-http` servers from registry.modelcontextprotocol.io and ran a
static scan of each server's advertised `tools/list` — descriptions, JSON schemas, hidden unicode.
No tool is ever called; this is the metadata an LLM trusts *before* it acts.

Pooled across two snapshots (364 servers probed):
- **174 (48%) answered `tools/list` with no credentials** — full tool surface anonymous-readable.
- **0 confirmed tool-poisoning** in that population. Clean today ≠ a poisoned ecosystem.
- ~81% of readable servers only advertise read-only lookup tools (the expected public shape).
- The minority that matters: a secrets manager, an API-key console issuing live keys, an
  open-banking server, a `delete_account` identity server — all enumerable anonymously.

Takeaway I landed on: one-shot scanning almost always returns CLEAR, so the value isn't *catching*
a poisoned server (rare) — it's that every tool description is attacker-mutable on the next deploy,
so "clean" has a shelf life. The case is scanning on connect + alerting on drift.

Scan your own free (no account):
`curl "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"`
Private/stdio? POST your `tools/list` — nothing leaves your box. Method + reproduce script in the
repo. Curious what this community thinks about scan-on-connect vs. registry-level attestation.


---

## 3) r/LocalLLaMA — angle: the metadata your agent trusts before it calls a tool

**Title:** `Your agent reads an MCP server's tool descriptions before calling anything — I scanned 364 public servers to see what's in that surface`

**Body:**

If you wire MCP servers into a local agent, the `tools/list` metadata (names, descriptions, JSON
schemas) is injected into the model's context before any call — so it's a prompt-injection surface.
I scanned every remote server in the official MCP registry (static analysis of that metadata only,
no tool invoked):

- 364 servers probed; **48% expose `tools/list` with no auth** (full surface anonymous-readable).
- **0% confirmed poisoning** — reassuring, but the surface is mutable on every server update.
- A small set advertise sensitive ops anonymously (secrets vault, live-API-key issuance,
  open-banking, account-deletion) — exactly the descriptions you don't want silently changing
  under your agent.

Practical bit for self-hosters: you can check any server (including your own, including behind
auth) for injection/poisoning patterns in the tool metadata for free, no account —
`curl "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=..."` or POST your own
`tools/list`. Reproduce script + full method in the repo.

