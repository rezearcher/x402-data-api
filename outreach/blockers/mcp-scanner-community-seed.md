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

**POSITIONING (updated cycle 20 — read before posting):** there is now a well-funded
incumbent, **MCPSafe (mcpsafe.io)** — 39,736-package public registry, grade badges, $19–149/mo
Stripe tiers. If the post reads as "another free MCP scanner," the first reply is "how is this
different from MCPSafe?" and we lose. So do NOT lead with "free scanner." Lead with the **two
things MCPSafe structurally cannot do**, because its model is GitHub/Google login + source upload
to a third-party SaaS:
  1. **Zero-egress / private-server scan.** We never ingest your repo — you paste the `tools/list`
     your agent already sees, nothing is stored or uploaded. For an internal/proprietary MCP
     server you cannot send the source to a German SaaS; you can run this.
  2. **Agent-native, keyless, per-call.** It's one x402 endpoint an agent can call *mid-workflow*
     to vet a server before trusting it — no signup, no dashboard, no subscription. (MCPSafe is
     human-login + subscription; it can't be called by an autonomous agent in the loop.)
Acknowledge MCPSafe honestly in the post; don't pretend to be first. Differentiation, not denial.

**Where (pick 1-2, lowest friction first):**
1. r/mcp or r/LocalLLaMA (Reddit) — show-and-tell tone, lead with the privacy/zero-egress angle.
2. Hacker News `Show HN` — https://news.ycombinator.com/submit
3. MCP Discord / the modelcontextprotocol GitHub Discussions — "tools & resources" channel.
4. dev.to / a short post, cross-linked.

**Paste-ready copy (Show HN / Reddit title + body):**

> Title: Show: A zero-egress MCP tool-poisoning scanner you can run on a private server (paste tools/list)
>
> When an agent connects to an MCP server, every tool's name, description and schema becomes
> trusted model context — so a server can hide instructions in a field your UI never renders
> (the disclosed WhatsApp-MCP exfiltration is the canonical case). There are good hosted scanners
> now (MCPSafe, Invariant), but they want you to point them at a public repo or sign in and upload
> source — which you can't do for an internal or proprietary server. This one is the opposite:
> you paste the `tools/list` your client already fetched, it runs against a zero-egress endpoint
> that never invokes your tools and stores nothing, and it flags concealed instructions,
> data-exfiltration hints, cross-tool shadowing and hidden-unicode payloads (OWASP LLM01/08).
> No signup. There's also a one-call x402 endpoint if you want an agent to vet a server in the loop.
>
> Scanner: https://x402-data-api.sigrunner.workers.dev/scan/mcp-scanner
> How the attack works: https://x402-data-api.sigrunner.workers.dev/learn/mcp-tool-poisoning
>
> Feedback on false positives/negatives welcome — happy to add detections.

**After posting:** reply to any thread as yourself; route genuine paid interest (CI monitoring,
full audits) to contact@greyridgesignals.ai. That's the conversion moment the whole surface is built for.

_Filed 2026-10-22 cycle t; repositioned cycle 20 after competitor mapping (MCPSafe). commit 0ddf32f, CF 64f5751a._
