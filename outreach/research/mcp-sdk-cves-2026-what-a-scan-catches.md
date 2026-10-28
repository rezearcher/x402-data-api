The headlines of 2026 made it sound like every MCP server is one request away from compromise. The primary records tell a more useful story — and they draw a sharp line between the problems a security *scan* can see and the problems only an *update* can fix. If you ship an MCP server, that line is the difference between buying the right protection and buying a false sense of safety.

## The 2026 MCP incidents, from the primary records

Skip the aggregator blogs and read the advisories. The official Model Context Protocol **Go SDK** alone carried four High-severity GitHub Security Advisories between February and April 2026:

- **DNS rebinding protection disabled by default** on localhost servers — `GHSA-xw59-hvm2-8pj6` / **CVE-2026-34742**, CVSS v4.0 **7.6 (High)**. Affected every version before **1.4.0**; patched in 1.4.0.
- **Cross-site tool execution over Streamable HTTP** — the transport did not check request origin or require a JSON content type, so a malicious web page could reach a local MCP server and trigger tool calls. `GHSA-89xv-2j6f-qhc8` / **CVE-2026-33252**, CVSS v3.1 **7.1 (High)**. Affected 1.4.0 and earlier; patched in **1.4.1** (needs Go 1.25+).
- **Improper handling of a null Unicode character when parsing JSON** — `GHSA-q382-vc8q-7jhj`, High.
- **Improper handling of case sensitivity** — `GHSA-wvj2-96wp-fq3f`, High.

Those are not blog rumors — they are published advisories with fix versions you can `go get` today. The widely-cited **"200,000 exposed servers"** figure comes from OX Security's April 2026 disclosure and was repeated across The Register, VentureBeat and others; treat the exact count as a vendor estimate, not a measured census. And be skeptical of the sequential-ID CVE tables some directories publish — several list `CVE-2026-1001`-style entries with no primary record behind them. Cite what has an advisory; ignore what doesn't.

## What a tool-description scan actually catches — and what it can't

Here is the part most "MCP security" marketing quietly skips. **Grey Ridge's scan is static detection of OWASP LLM01 (prompt injection) and LLM08 (excessive agency) patterns in your server's tool metadata**, plus directory-readiness and continuous monitoring. On a real server that looks like this (live, keyless, right now):

```
GET /scan/mcp/preview?url=https://mcp.deepwiki.com/mcp
-> tools_scanned: 3, issue_count: 0, risk_score: 0, grade: A, verdict: "clear"
   "No tool-poisoning/injection patterns detected across 3 tool(s). Clean on static checks."
```

That is genuinely useful: tool-poisoning and injected instructions live in the tool *descriptions* the model reads, and a static scan reads them the same way. But notice what that scan **cannot** see:

- It does **not** test your transport. DNS rebinding (CVE-2026-34742) and cross-site tool execution (CVE-2026-33252) live in the SDK's HTTP handling, not in a tool description. No metadata scanner — ours or anyone's — finds them.
- It is **not a penetration test** and not a code audit. "Grade A / clear" means *no injection patterns in the metadata we checked*, not "safe." Our own grade scale says so plainly (A = risk 0-9; it is our grade, not a third-party certification).
- It cannot tell you your dependency is three releases behind a patch.

Anyone selling you a one-off scan as "your MCP server is secure" is selling the wrong line. The honest claim is narrower and more true: *clean on static injection checks, on the metadata we saw, today.*

## The real exposure is drift, not a clean bill

Re-read the Go SDK list. Every one of those servers was "fine" — until the SDK underneath it wasn't, and the operator didn't update. That is the dominant MCP failure mode in 2026: not a dramatic zero-day in your code, but **the slow gap between "upstream shipped a fix" and "you noticed."** The deepwiki example above is grade A on injection yet still shows **6 soft directory-readiness blockers** (tool titles, read-only hints, descriptions) — quality drift that a single scan date can't keep up with.

A one-time scan is a photograph. The exposure is a movie. The only thing that closes the SDK-CVE gap is a discipline: know when your posture changes, and update. That is a monitoring problem, not a scanning problem — which is exactly why a hosted, continuously-re-checking signal beats a CLI you run once and forget.

## Where Grey Ridge fits — honestly

We do one layer well and we name the layers we don't touch:

- **Free, keyless, no account:** paste your server URL into [the free preview](https://api.greyridgesignals.ai/scan/mcp/preview?url=https://mcp.deepwiki.com/mcp) and get grade, risk score, and injection verdict in one request. Agents can pull the full itemized report for **$0.05 over x402** (zero-egress `POST /scan/mcp`).
- **Continuous monitoring + drift alerts: $9.99/mo** by card at [/pricing](https://api.greyridgesignals.ai/pricing) — one key runs 100 scans across every endpoint, so you re-check each release before you ship it.
- **An embeddable live badge** that re-checks your public server on every render and links to the full report — it flips the day a new tool breaks your posture, before a Directory reviewer (or a user) sees it. See the [live security leaderboard](https://api.greyridgesignals.ai/scan/leaderboard.svg?n=12) it draws from.

What we are **not**: a transport pentest, a Go/Rust code audit, or a dependency scanner. If a 2026 SDK CVE is your worry, the fix is `go get` to 1.4.1 and a tool that watches your versions — pair that with us; don't expect a metadata scan to do it. We'd rather tell you that than take your money for a scope we don't cover.

## Positioning vs. the tools you already use

Snyk and Dependabot are excellent at the layer we don't touch: they'll flag that your Go SDK is below 1.4.1 and open the bump PR. They do **not** read your MCP tool descriptions for prompt-injection or excessive-agency patterns, and they don't check Anthropic Directory readiness. GoPlus-style REST APIs score tokens, not MCP metadata. The layers are complementary — update your SDK *and* watch your tool surface. Grey Ridge is the second half, hosted and continuous, at a price a solo maintainer can run forever.

## Try it in one request

No key, no signup: `GET https://api.greyridgesignals.ai/scan/mcp/preview?url=<your-server-url>`. If it comes back clean, embed the [badge](https://api.greyridgesignals.ai/pricing) and let it keep watch. If it doesn't, you'll know exactly which tool and which pattern — before anyone else does.
