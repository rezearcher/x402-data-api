# Rez atom: publish the readiness Action to the GitHub Actions Marketplace

**What:** list `rezearcher/mcp-directory-readiness` on the GitHub Actions Marketplace so connector developers find it when they search the Marketplace for Claude / MCP CI checks. The repo, code, and v1.0.0 release already exist and are verified working — this is the one step that is UI-only and needs your GitHub account + 2FA.

**Why it needs you:** GitHub has no API/CLI for Marketplace listing. It requires accepting the GitHub Marketplace Developer Agreement (one-time, per account) and checking a box on a release page, both behind your authenticated session with 2FA.

**Steps (~2 min):**
1. Go to https://github.com/rezearcher/mcp-directory-readiness/releases/tag/v1.0.0
2. Click **Edit** (pencil) on the v1.0.0 release.
3. Check **"Publish this Action to the GitHub Marketplace."**
4. Accept the GitHub Marketplace Developer Agreement if prompted.
5. Pick categories: **Continuous integration** + **Security** (primary: Security).
6. Click **Update release.**

That's it — the Action then shows at `https://github.com/marketplace/actions/claude-connector-directory-readiness` and is searchable.

**Standing (separate) atom:** `npm login && npm publish --access public` on greyridge-x402-tools v0.3.0 (see npm-publish-scanner.md) — self-distributes the scanner to Socket.dev/Glama. Independent of this.
