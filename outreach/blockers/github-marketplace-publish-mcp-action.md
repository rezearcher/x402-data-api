# Blocker: publish the MCP Security Gate Action to GitHub Marketplace

**Why it matters (revenue):** The proven-converting channel for our x402 business is the
MCP-security niche (the only channel to get 2/2 engagement so far — mcp-egress, mcpcost).
Our free CI Action (`rezearcher/greyridge-x402-tools@v0.2.1`) is the hook; the paid
`/scan/mcp` ($0.05 x402) itemized report is the backend. GitHub Marketplace is the one
organic-discovery surface where devs *searching* for "MCP security" find and `uses:` the
Action with zero cold-outreach from us. Everything else is prepped — this is the only step
that needs Rez's account + the one-time Developer Agreement acceptance (not exposable via
API/`gh`; GitHub only allows marketplace publishing through the web UI).

**Already done (no action needed):**
- `action.yml` at repo root with required `branding:` (icon: shield, color: red). ✓
- Releases cut and tagged: `v0.2.1` (latest), `v0.2.0`. ✓
- README has a full copy-paste workflow + Action usage + free/paid funnel. ✓
- Repo is PUBLIC; topics set for GitHub Topics discovery (mcp-security, tool-poisoning,
  prompt-injection, owasp-llm, github-actions, security-scanner, …). ✓
- Verified live end-to-end: `/scan/mcp/preview`, `/scan/mcp` 402 challenge (spec-compliant
  x402 v2 exact-EVM, $0.05 USDC Base), and the shields.io badge all render from datacenter
  IPs (so the badge works in any README). ✓

**The exact one-time click-path for Rez (~2 min):**
1. Go to https://github.com/rezearcher/greyridge-x402-tools/releases
2. Click **Edit** on the `v0.2.1` release (the latest).
3. Check the box **"Publish this Action to the GitHub Marketplace."**
4. Accept the **GitHub Marketplace Developer Agreement** (one-time, tied to your account).
5. Pick a primary category: **Code quality** or **Security** (Security preferred).
   Secondary (optional): **Continuous integration**.
6. Click **Update release**.

GitHub will validate the Action automatically (name uniqueness, metadata, README). If it
rejects the action `name`, the only likely fix is a slightly more unique `name:` in
`action.yml` — ping and I'll adjust it same-cycle.

**Result when done:** the Action appears at
`https://github.com/marketplace/actions/<slug>` and in Marketplace search for "MCP security",
giving organic, no-outreach discovery into the exact converting audience.
