# Blocker: publish the MCP scanner to the npm registry (one-time, ~3 min)

**Status:** everything is prepared and pushed. The only remaining step needs an npm
account login, which is yours. This is the single highest-leverage distribution step
we have, and it is evidence-backed (see "Why" below) — not another listing-PR.

## The one command (after a one-time `npm login`)

```bash
git clone https://github.com/rezearcher/greyridge-x402-tools.git
cd greyridge-x402-tools
git checkout v0.3.0
npm login            # one-time: Grey Ridge npm account (create free at npmjs.com if none)
npm publish --access public
```

That's it. The package name is `greyridge-x402-tools` (unscoped, public). It is a
pure-Node, zero-dependency CLI (`mcpscan`, `rugcheck`, `greyridge-x402-tools`), MIT
licensed, so there is nothing to build and no secrets in the package — `npm publish`
just uploads `bin/`, `README.md`, `LICENSE` (the `files` allowlist in package.json).

After it's live, verify:
```bash
npx mcpscan@latest https://mcp.deepwiki.com/mcp     # should print a verdict
```
and check the page renders: https://www.npmjs.com/package/greyridge-x402-tools

## Why this is the lever (evidence, 2026-10-22)

Ground truth this cycle: the fiat product (/pricing, $9.99/mo monitoring) is complete
and live, but has ~0 human top-of-funnel — `/pricing` logged ≈8 sampled hits in 30
days, `/learn` zero. Discovery is 100% the gate.

Researched how comparable MCP-security tools actually get discovered by humans
(not by agents — that lane is a proven $0 desert). Every paid competitor uses the
**package-registry → auto-index → search** channel, which is self-distributing (publish
once, humans find it via search; no pitching):

- `mcp-server-security-scanner` — on **npm**, auto-indexed by **Socket.dev**; pricing
  free-trial → $19 / $79 / $499 per month.
- `ramparts` (Rust) on crates.io/docs.rs; `mcp-audit-scanner`, `rob925/mcp-shield` on
  **PyPI**; MCPSafe listed on Product Hunt / PeerPush / Glama.
- Our `$9.99/mo` sits *under* the market floor ($15–19/mo), so price is not the gap —
  presence in the registry index is.

Our scanner currently only runs via `npx github:rezearcher/...`, which is invisible to
npm search and to Socket/Glama's npm crawlers. Publishing to the registry puts it in
the one index human MCP operators actually browse, with keywords
(`mcp-security`, `tool-poisoning`, `prompt-injection`, …) that npm search ranks on.

The free CLI is the top-of-funnel magnet; its output and README now funnel to the
$9.99/mo continuous-monitoring plan (prepared in v0.3.0, commit 0312185).

## Optional, higher-reach follow-ons (also one-time, your account)
- **Socket.dev** auto-indexes npm packages — no action needed once published; the page
  appears at `socket.dev/npm/package/greyridge-x402-tools` within a day or two.
- **Product Hunt / PeerPush** launch post (where MCPSafe got found) — your identity.
- **GitHub Marketplace**: the Action (`action.yml`) is already branding-complete; publish
  via the repo UI "Draft a release → Publish to Marketplace" on the v0.3.0 tag.
