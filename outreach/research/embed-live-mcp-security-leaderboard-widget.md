# Put a live MCP security leaderboard on your site — the free, drop-in widget

If you run a developer blog, an MCP directory, or an awesome-list, you can now embed a **live, ranked security leaderboard for public MCP servers** with one line of HTML. It renders as a plain SVG image, updates on its own, and loads even if our backend is mid-deploy. It is free to host, and it shows the one thing the big directories still don't: a per-server static **prompt-injection / tool-poisoning grade** (OWASP LLM01/LLM08).

Here is the live widget, embedded exactly the way you would embed it:

[![MCP Security Leaderboard by Grey Ridge Signals](https://api.greyridgesignals.ai/scan/leaderboard.svg?n=10)](https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html)

That image is not a screenshot. It is served live from `/scan/leaderboard.svg`, ranked from the same corpus of **144 public MCP servers** we grade and re-scan, and it will change as servers are added or their grade moves.

## The one line

**Markdown (README, blog):**

```
[![MCP Security Leaderboard by Grey Ridge Signals](https://api.greyridgesignals.ai/scan/leaderboard.svg)](https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html)
```

**HTML:**

```html
<a href="https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html" target="_blank" rel="noopener">
  <img src="https://api.greyridgesignals.ai/scan/leaderboard.svg" alt="MCP Security Leaderboard by Grey Ridge Signals" width="600">
</a>
```

**Async JavaScript (auto-injects into a div):**

```html
<div id="grey-ridge-mcp-leaderboard"></div>
<script async src="https://api.greyridgesignals.ai/scan/leaderboard.js"></script>
```

Size it with `?n=` (3–25 rows, default 10) and theme it with `?theme=light|dark`. The full copy-paste page is at [/scan/leaderboard/embed](https://api.greyridgesignals.ai/scan/leaderboard/embed).

## What the ranking actually measures (read this before you trust any leaderboard)

Every row is a **static** check for injection and tool-poisoning patterns in an MCP server's advertised tool surface — the OWASP LLM01 (prompt injection) and LLM08 (excessive agency / tool poisoning) failure classes. A server graded **A / "clear"** means *no static injection pattern was found in its tool descriptions and schemas at scan time*. It does **not** mean the server is "safe," audited, or free of runtime or supply-chain risk. We never say "safe," and neither should a badge.

The ranking order is deterministic: grade first (A→F), then directory-readiness, then risk score, then blocker count. Today the top of the board looks like this — every leading server is currently clear of static injection:

| # | Server | Grade | Static injection risk |
|---|--------|-------|-----------------------|
| 1 | BeachClubs.ae | A | 0 |
| 2 | Cloudflare Docs | A | 0 |
| 3 | Getlead | A | 0 |
| 4 | Hugging Face | A | 0 |
| 5 | mcp.adoraads.ai | A | 0 |

*(Live top-10 render in the widget above; full 144-server board on the [ranked hub](https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html).)*

A board full of A's is itself an honest signal: static tool-poisoning in *published* MCP servers is currently rare. The value isn't catching a dumpster fire — it's a verifiable, re-checked baseline, and an early-warning line when a future release introduces a pattern that wasn't there before.

## How this is different from the other MCP security boards

The niche has real players now, and they're good. Position us honestly:

- **mcpwatch** grades A–F and offers a per-server live badge + JSON API, scanned daily. Strong for a single server's badge.
- **Sentinel-style registries** publish per-row embeddable badges with findings cited to a line of code.
- **Glama / Smithery** rank servers by popularity and usage — not by a security grade at all.

What this widget adds that those don't: it drops the **whole ranked board** onto your page as one zero-dependency SVG — not just a single-server badge — so a directory, blog, or awesome-list can show the live ranking in-line. And it is **degrade-open by design**: the image always returns a valid card and never 500s, so it is safe to put on a page you can't babysit. If a leaderboard widget can hard-fail and blank out your README, you won't embed it; ours can't.

Two more edges worth naming plainly:

1. **Base / DeFi MCP coverage.** Grey Ridge came from the trade-safety side (honeypot and rug checks for on-chain agents), so DeFi-adjacent MCP servers are first-class in the corpus, not an afterthought.
2. **Continuous monitoring to hold your rank.** A one-off grade goes stale the moment a server ships a new tool. The paid tier re-scans your server, alerts on drift, and keeps your public badge honest — the badge is only as good as the re-check behind it.

## If you publish an MCP server: how to rank #1 for security

The leaderboard is also an incentive — being visibly graded **A / clear** is a trust signal your users can check themselves.

1. **Scan your server free** → [greyridgesignals.ai/scan/mcp-scanner](https://api.greyridgesignals.ai/scan/mcp-scanner). You get your static LLM01/LLM08 grade and any blockers.
2. **Claim a verified badge** → [/scan/verify](https://api.greyridgesignals.ai/scan/verify). Prove ownership (DNS or well-known file), and your row carries a verified marker.
3. **Keep it live** → [monitoring at $9.99/mo](https://api.greyridgesignals.ai/pricing) re-scans on a schedule, alerts you on any drift, and keeps the public badge green and honest.

The scan is the product that earns the badge; the badge is the thing your users — and now anyone embedding this leaderboard — can see.

---

*Grey Ridge Signals — static OWASP LLM01/LLM08 scanning + continuous monitoring for MCP servers. "Clear" means no static injection pattern was found at scan time, not a guarantee of safety or a penetration test. Embed the live board from [/scan/leaderboard/embed](https://api.greyridgesignals.ai/scan/leaderboard/embed).*
