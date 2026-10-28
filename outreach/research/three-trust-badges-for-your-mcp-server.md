When a developer connects an agent to your MCP server, they are trusting three different things at once — and almost no server tells them about any of the three. They are trusting that your advertised tool metadata is free of prompt-injection and tool-poisoning (the OWASP LLM01/LLM08 classes). They are trusting that your server is built to the standard a connector directory will actually accept. And they are trusting that you are not an outlier against your peers. Those are three independent questions. A server can pass one and fail the others, and today the person connecting has no way to see it.

Grey Ridge now answers all three from a single static scan, and hands you three copy-paste README badges to prove it — one per axis, each one a link your users can click and re-verify themselves. You generate them at [the badge page](https://api.greyridgesignals.ai/scan/badge-gen) by pasting your server URL. No account, no email, no install.

## The three axes are independent — here is live proof

These badges are not screenshots. Each image is served live from our Worker, re-scanned on a schedule, and will change the moment your server does. Here are two real public MCP servers, scanned right now, static metadata only — we never call their tools.

**Cloudflare Docs MCP** — clean on all three:

[![MCP security verdict](https://api.greyridgesignals.ai/scan/mcp/badge?url=https%3A%2F%2Fdocs.mcp.cloudflare.com%2Fmcp)](https://api.greyridgesignals.ai/scan/mcp-scanner?url=https://docs.mcp.cloudflare.com/mcp) [![Claude Directory readiness](https://api.greyridgesignals.ai/scan/verify/badge?kind=directory&url=https%3A%2F%2Fdocs.mcp.cloudflare.com%2Fmcp)](https://api.greyridgesignals.ai/scan/directory) [![MCP security rank](https://api.greyridgesignals.ai/scan/leaderboard/rank-badge?url=https%3A%2F%2Fdocs.mcp.cloudflare.com%2Fmcp)](https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html)

At the time of writing that reads `A · clear (2 tools, 0 issues)`, `ready`, and `#2 of 25 · grade A`. All three green. This is the model case.

**DeepWiki MCP** — clean security, but not yet directory-ready or ranked:

[![MCP security verdict](https://api.greyridgesignals.ai/scan/mcp/badge?url=https%3A%2F%2Fmcp.deepwiki.com%2Fmcp)](https://api.greyridgesignals.ai/scan/mcp-scanner?url=https://mcp.deepwiki.com/mcp) [![Claude Directory readiness](https://api.greyridgesignals.ai/scan/verify/badge?kind=directory&url=https%3A%2F%2Fmcp.deepwiki.com%2Fmcp)](https://api.greyridgesignals.ai/scan/directory) [![MCP security rank](https://api.greyridgesignals.ai/scan/leaderboard/rank-badge?url=https%3A%2F%2Fmcp.deepwiki.com%2Fmcp)](https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html)

That reads `A · clear (3 tools, 0 issues)`, `needs polish`, `not ranked · scan free`. The security scan is as clean as Cloudflare's — but the directory axis flags polish work, and because DeepWiki has no published scorecard yet it carries no rank. Same server, three different answers. That is exactly why one badge is not enough.

## What each badge actually means

**Security verdict** (`mcp-scan`, re-scanned every 6 hours). A static read of your advertised tool names, descriptions, and JSON schemas for the prompt-injection and tool-poisoning patterns in OWASP LLM01/LLM08 — hidden-instruction text, invisible-character smuggling, schema abuse. A grade and an issue count. This is static metadata analysis, not a penetration test, and `clear` is a point-in-time read, not a guarantee that your server is safe.

**Claude Directory readiness** (`claude directory`, cached 30 minutes). Checks your server metadata against the submission criteria a connector directory expects — tool descriptions present, hints and titles populated, no custom-query gaps. `ready`, `needs polish`, or `likely reject`. This is our reading of the criteria, not an endorsement from Anthropic.

**Security rank** (`MCP Security Rank`, cached 1 hour). Your position among the servers we publish — e.g. `#2 of 25`. Rank is a position decided by readiness and risk tiebreaks across a densely-clean field; it is a vanity and discovery signal, not a claim that a lower-ranked server is unsafe. It populates once your report is published.

All three come from the same corpus of **144 public MCP servers** we grade and re-scan (last refreshed 2026-10-27).

## Why three badges from one scan, versus the alternatives

Most of the MCP trust surface gives you one number. mcpwatch ships a single A–F security badge. Glama and Smithery rank servers by popularity and install count, not by what their tool metadata actually contains. A one-off CLI like Snyk's gives you a scan result but no public, continuously-updating badge your users can click. None of them separate "is the metadata clean" from "is this directory-ready" from "how does it compare" — and none cover Base/DeFi-focused MCP servers the way we do.

The honest gap we fill: three independent, verifiable trust axes from a single paste, rendered as copy-paste README markdown, re-scanned on a schedule, with no account required. If all you want is a one-time local scan, a CLI is fine. If you want a badge your users can click and re-verify — and that keeps itself current — that is this.

## Claim it so it stays yours

The badges above work on any public server immediately. To claim your server — lock the badge to a verified owner, turn on continuous monitoring and drift alerts so the badge flips if your tool metadata changes — you prove you control the domain with a one-time DNS TXT record. Fully automated, no email, no account. Agents that prefer per-call pay inline over x402 at $0.05/scan; the free badge keeps re-scanning every six hours regardless.

[Generate your three badges](https://api.greyridgesignals.ai/scan/badge-gen) · [Browse the MCP security directory](https://api.greyridgesignals.ai/scan/directory) · [See pricing & monitoring](https://api.greyridgesignals.ai/pricing)
