# Blocker: seed the free MCP Security Scanner into 1-2 MCP-dev communities

**Why this is a Rez atom:** every zero-capital BUILD lever is done — the MCP-security
product + all its organic surfaces are shipped, deployed and verified. The remaining gap
is **distribution**, and the one active channel that converts for a dev tool (posting it
where MCP developers gather) requires a **human identity + account** I don't have and must
not fake. Posting anonymously/at-volume is the saturated, forbidden cold-outreach lane.
One authentic post from Rez is not. This is a ~5-minute, one-time action.

**The asset to share (all live, verified 2026-10-22):**
- Free in-browser scanner (paste your own `tools/list`, private/local servers never leave your hands):
  https://x402-data-api.sigrunner.workers.dev/scan/mcp-scanner
- Explainer (how tool poisoning works, WhatsApp-MCP case): https://x402-data-api.sigrunner.workers.dev/learn/mcp-tool-poisoning
- State-of-MCP-security data report: https://x402-data-api.sigrunner.workers.dev/scan/census

**Where (pick 1-2, lowest friction first):**
1. r/mcp or r/LocalLLaMA (Reddit) — "I built a free scanner for..." Show-and-tell tone.
2. Hacker News `Show HN` — https://news.ycombinator.com/submit
3. MCP Discord / the modelcontextprotocol GitHub Discussions — "tools & resources" channel.
4. dev.to / a short post, cross-linked.

**Paste-ready copy (Show HN / Reddit title + body):**

> Title: Show: A free scanner for MCP tool-poisoning / prompt-injection (paste your tools/list)
>
> When you connect an agent to an MCP server, every tool's name, description and schema is
> fed into the model as trusted context — so a server can hide instructions in a description
> your UI never shows (the disclosed WhatsApp-MCP exfiltration is the canonical case). I built
> a free static scanner: paste your server's `tools/list` and it flags concealed instructions,
> data-exfiltration hints, cross-tool shadowing and hidden-unicode payloads (OWASP LLM01/08).
> It runs against a zero-egress endpoint and never invokes your tools, so local/private servers
> stay private. No signup.
>
> Scanner: https://x402-data-api.sigrunner.workers.dev/scan/mcp-scanner
> How the attack works: https://x402-data-api.sigrunner.workers.dev/learn/mcp-tool-poisoning
>
> Feedback on false positives/negatives welcome — happy to add detections.

**After posting:** reply to any thread as yourself; route genuine paid interest (CI monitoring,
full audits) to contact@greyridgesignals.ai. That's the conversion moment the whole surface is built for.

_Filed 2026-10-22 cycle t. commit 0ddf32f, CF 64f5751a._
