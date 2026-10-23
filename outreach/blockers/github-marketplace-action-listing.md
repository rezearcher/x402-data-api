# Blocker: publish the MCP scanner as a GitHub Marketplace Action

**Why this is the atom:** The GitHub Actions Marketplace is organic developer discovery
(devs search it for security/CI actions) — no sales team, no ad spend, no capital. It is the
native channel for our CI admission-gate product. Everything a listing needs is already done:
the Action has `action.yml` at the repo root with Marketplace branding (`shield`/`red`), and
a published release (`v0.3.1`) exists. The only step left requires your GitHub identity: a
**one-time** acceptance of the GitHub Marketplace Developer Agreement.

**Repo:** https://github.com/rezearcher/greyridge-x402-tools
**Release to publish from:** https://github.com/rezearcher/greyridge-x402-tools/releases/tag/v0.3.1

## Exact steps (~2 minutes, one-time)

1. Open the release: https://github.com/rezearcher/greyridge-x402-tools/releases/tag/v0.3.1
2. Click **Edit** (pencil) on the release.
3. You'll see a banner: **"Publish this Action to the GitHub Marketplace."** Check it.
4. Accept the **GitHub Marketplace Developer Agreement** (one-time, applies to all future releases).
5. Pick a primary category (**Security**) and optionally a secondary (**Continuous integration**).
6. GitHub validates the `action.yml` (name unique, has description + branding — already satisfied).
7. Click **Update release**. The Action is now listed at
   `https://github.com/marketplace/actions/<slug>` and searchable in the Marketplace.

## After it's live (I handle, zero further Rez)
- I'll add the Marketplace badge/link to the README and the landing page.
- Future releases publish to Marketplace with the same checkbox (agreement already accepted).

## Notes
- No code change needed — the Action is Marketplace-ready as of v0.3.1.
- No capital, no payout account involved (listing a free Action is free).
- If the name "MCP server tool-poisoning scan" collides with an existing listing, GitHub will
  ask for a unique name — tell me and I'll rename `action.yml`'s `name:` and cut a patch tag.
