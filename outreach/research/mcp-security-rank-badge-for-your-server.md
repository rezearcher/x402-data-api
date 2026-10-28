Every MCP security badge on the market tells you one thing: your grade. A letter, a health score, a pass/fail. Useful — but when nearly every public MCP server scans clean, a wall of grade-A badges all say the same thing. None of them tell you where you *stand*.

We shipped the one that does. The Grey Ridge **MCP Security Rank** badge shows your server's position in a public, continuously re-ranked field — not just `grade A`, but `#66 of 144 · grade A`. That is a number an author actually wants to display.

## What it looks like

Here is the live, auto-updating top of the ranked field (rendered straight from our leaderboard endpoint — this image changes as servers are scanned and re-ranked):

![MCP Security Leaderboard — live](https://api.greyridgesignals.ai/scan/leaderboard.svg?n=10)

And here is a single server's rank badge, served live right now for DeepWiki's MCP server:

`#66 of 144 · grade A` — brightgreen

That string is not hand-typed. It comes from `GET /scan/leaderboard/rank-badge?url=<your-server>` as a [Shields.io](https://shields.io) endpoint object, so it renders as a normal README badge and updates itself every time the board moves.

## How an author gets it (free, 30 seconds)

Run the free scan on your own server. The preview response now attaches a `leaderboard_rank` block with everything you need:

```json
{
  "rank": 66,
  "total": 144,
  "grade": "A",
  "badge_markdown": "[![MCP Security Rank](https://img.shields.io/endpoint?url=.../rank-badge%3Furl%3D...)](https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html)"
}
```

Copy `badge_markdown`, paste it in your README, done. The badge image links back to your scorecard on the ranked hub, so the embed doubles as proof a reader can click and verify. Not ranked yet? The endpoint degrades open — it returns a grey `not ranked · scan free` card and never errors, so a badge in your README can't break your page.

## What the rank actually means (and what it does not)

Be clear-eyed about this, because we are. The board ranks **144 public MCP servers by our static injection-security grade** — OWASP LLM01 (prompt injection) and LLM08 (excessive agency / tool-poisoning) patterns detected in tool descriptions and schemas. Ties are broken by connector-directory readiness, then risk score, then blocker count.

Most public MCP servers currently scan clear, so the field is densely grade-A. That means a high rank is a **position in a clean field decided by the finer tiebreaks** — it is not a claim that `#3` is dramatically safer than `#100`. A `grade A` means *our static checks found no injection pattern*; it does not mean "audited," "pentested," or "safe." No static scan can promise that. The badge's honest value is twofold: it proves your server is in the graded field with nothing flagged, and it gives you a competitive, public, self-updating marker — which is exactly why an author wants to show it.

## Why rank, when everyone else ships a grade

The MCP security-badge space filled up fast in 2026. The honest landscape:

| Tool | What its badge shows | Rank in a public field? |
|---|---|---|
| **[mcpwatch](https://socket.dev/npm/package/mcpwatch-mcp)** | A–F letter grade (OWASP MCP Top 10), SVG + GitHub Action | No — absolute grade only |
| **[Project Shield](https://glama.ai/mcp/servers/@Whitening-Sinabro/project-shield)** | Verifiable security badge, proprietary / paid tiers | No |
| **[mcp-observatory](https://mcpservers.org/hi/servers/kryptosai/mcp-observatory)** | SVG health score + CI snippet | No |
| **[Glama](https://glama.ai)** | Directory "safe-to-assess" badge | No — listing, not a security score |
| **Grey Ridge** | `#N of 144 · grade A`, live-ranked, degrade-open | **Yes** |

When every badge is grade A, a grade badge markets nothing. A *rank* badge markets you — "we're #3 of 144 on public MCP security" is a line a maintainer puts in a release note. That is the whole point: the vanity is the distribution. Every author who embeds it to show off their rank plants a verifiable, clickable backlink to the ranked hub, which pulls the next author in to check theirs.

## Holding your rank is where monitoring earns its keep

A one-off grade is a photograph. MCP servers ship new tools, rewrite schemas, pull in dependencies — any of which can introduce an injection pattern that drops your grade and your rank between releases. The rank badge is backed by a hosted re-scan (every 6 hours) so the number on your README stays true, and paid monitoring ([/pricing](https://api.greyridgesignals.ai/pricing)) alerts you the moment a change would move you — before a reader sees it slip. That is the gap every CLI-only or one-shot grade badge leaves open: they grade the commit in front of them and go quiet. The rank has to be defended to stay green, and defending it is the product.

## Get your rank

- **Scan your server free** and grab your `badge_markdown`: [api.greyridgesignals.ai/scan/mcp-scanner](https://api.greyridgesignals.ai/scan/mcp-scanner)
- **See the live ranked board:** [the MCP Security Leaderboard](https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html)
- **Keep your rank green across releases:** [continuous monitoring](https://api.greyridgesignals.ai/pricing)

Static LLM01/LLM08 detection and monitoring — an honest, public, defensible marker for MCP authors who ship responsibly. Not a pentest, not a safety guarantee. A rank you can earn, show, and keep.
