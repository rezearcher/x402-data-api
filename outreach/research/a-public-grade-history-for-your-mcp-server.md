# Your MCP server's security grade now has a public history

SSL Labs changed how people reason about TLS. Not because it found new attacks — because it put a single **A–F grade** on a public page anyone could link to, and kept the history. A grade that drops from A to C is a conversation a team actually has. A 40-page PDF is not.

MCP servers have no equivalent. You ship a `tools/list`, an agent wires it into a wallet, and the only "security signal" is whether someone happened to read the tool descriptions that day. There's no public grade, no before/after, no way to see that last week's clean server quietly added a tool that harvests a `private_key`.

We built that missing page. Every server we scan gets a [public report](https://api.greyridgesignals.ai/scan/report), and for monitored servers it carries a **dated grade-history timeline** — the same idea SSL Labs applies to TLS, applied to an MCP tool manifest.

## What the grade actually means

The grade is derived purely from our own risk score and critical-finding count — it's a **Grey Ridge Signals grade, not an external certification**, on the familiar SSL Labs / securityheaders.com band convention:

| Grade | Condition |
|-------|-----------|
| **F** | any critical finding, or risk score ≥ 70 |
| **D** | risk score ≥ 50 |
| **C** | risk score ≥ 30 |
| **B** | risk score ≥ 10 |
| **A** | risk score < 10 |

A critical finding forces an F regardless of the numeric score — a server that asks for a `private_key` or `seed_phrase` input does not get a C just because the rest of its manifest is clean.

Two live scans from the free preview, run today:

- A clean read-only tool (`get_weather`, one `city` string): **grade A · verdict clear · risk 0**
- A tool that declares `private_key` and `seed_phrase` inputs: **grade F · verdict block · risk 40** — the numeric score alone would be a C, but the wallet-secret critical pins it to F.

No signup, no key: `POST /scan/mcp/preview` with your `tools` array returns the grade and verdict.

## The part that's actually new: the history

A one-off grade is a snapshot. Supply-chain risk in MCP is not a snapshot — a server you admitted at grade A can regress the week it adds a tool, changes a description to smuggle an instruction, or starts fetching remote instructions it then obeys. The one-off scan you ran at install time can't see that.

For monitored servers, the public report shows a grade-trend line across recorded scans — literally:

> **Grade trend: A → F over the last 6 recorded scans · regressed 2 bands.**

…above a dated table of every change: **when**, the **event**, the **verdict**, the **grade**, the **risk score**, and the **severity mix** of findings that appeared or resolved at that point. The trend only renders once there are at least two graded scans to compare — there's no fabricated "regression" on a first baseline. The band delta (A=4 … F=0; a drop in letters = a regression) is computed one way, in one place, so the timeline and the drift alert always say the same thing.

## Honest scope — what this is and isn't

This is **static analysis** of the tool manifest plus **continuous re-scanning** — it maps to the MCP/LLM failure classes we can read from `tools/list`: wallet-secret / wallet-drainer parameter harvesting (`private_key`, `seed_phrase`, `mnemonic` inputs), tool poisoning, prompt injection, and remote/dynamic instruction-injection (the fetch-and-obey pattern that defeats hash-pinning). That's LLM01 (prompt injection) and LLM08 (excessive agency) territory.

It is **not** a penetration test, not a runtime audit of what the server does with your data, and not a guarantee. We never label a server "safe" — we grade what's declared, and we tell you when that declaration changes. A clean grade means nothing critical is *visible in the manifest today*, not that the server is trustworthy forever. That's exactly why the history matters more than the snapshot.

## Where the public grade beats the tools you already have

Snyk and Socket are excellent at **dependency** risk — the npm/PyPI packages your server pulls in. Neither puts a **public, per-MCP-server A–F grade with a dated history** on a page you can link a teammate to. SSL Labs and securityheaders.com do public graded history — but for TLS and HTTP headers, not for an agent's tool surface. The gap we fill is narrow and specific: a continuously-updated, public, screenshot-able grade for the thing an autonomous agent actually trusts — the MCP tool manifest.

Scan any server free with `POST /scan/mcp/preview` (no signup, no key). Browse the [public MCP security report](https://api.greyridgesignals.ai/scan/report) and the [agent-facing route catalog](https://api.greyridgesignals.ai/for-agents/token-safety). Continuous monitoring — the dated grade history, plus a drift alert the moment a grade regresses between sweeps — is $9.99/mo on the [pricing page](https://api.greyridgesignals.ai/pricing).
