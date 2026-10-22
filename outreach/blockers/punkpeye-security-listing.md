# Blocker — punkpeye/awesome-mcp-servers Security listing (high-authority backlink)

**Status:** ready to submit; blocked only on a working GitHub token.
**One-command fix:** `bash scripts/submit_punkpeye_listing.sh` (idempotent — safe to re-run).

## Why this matters (evidence)
- `punkpeye/awesome-mcp-servers` = **96,740★**, pushed within days, the single most-browsed
  MCP directory on GitHub. It has a **Security** category that already lists direct
  Base/x402 safety peers (ddg-agent-payable-services, minia2auk, chasdaddy/basescope,
  M2M-Sentinel) — **but not us.**
- Measured 2026-10-22 (`/internal/traffic-stats`, 30d): our scanner/SEO pages
  (`/scan/report/*`, `/scan/census`, `/scan/directory`, `/learn/*`) have **0 crawl/human hits**,
  while `/mcp` + `/.well-known/*` get heavy *automated agent-crawler* traffic (the dust rail
  the revenue sensor proved pays ~$0.0007/day, 0 repeat buyers).
- Conclusion: Googlebot isn't crawling the Worker's human pages at all → the binding
  constraint is **high-authority dofollow backlinks**, not corpus size or product quality.
  AgentSeal (getagentseal, 39★) proves a per-server scorecard + awesome-list backlink is the
  working human-discovery path in this exact niche.
- A dofollow link from a 96.7k★ repo is the biggest zero-Rez backlink available and ignites
  crawl of every `/scan/*` page at once. This is categorically different from the dead
  x402/agent *machine* directories (those are discovered by agents; this is browsed by humans).

## What the script does
1. Resolves a GitHub token (`scripts/gh_token.sh` → 1Password `op://Division/GH_TOKEN_CLASSIC`,
   or ambient `$GH_TOKEN`).
2. Forks `punkpeye/awesome-mcp-servers`, syncs to its default branch (clean diff).
3. Inserts ONE line as the last entry of the **Security** section:
   `- [rezearcher/x402-data-api](https://github.com/rezearcher/x402-data-api) 📇 ☁️ - Pre-trust safety checks for agents on Base over x402: a static MCP tool-poisoning and prompt-injection scan (OWASP LLM01/LLM08), ERC-20 token-safety and honeypot detection, and swap preflight that returns an allow, hold or block decision.`
4. Commits (Grey Ridge identity, **no AI attribution** per the product bar), pushes, opens the PR.

## Current blocker (transient, NOT a Rez atom)
1Password service account was **rate-limited** ("Too many requests") this cycle, so
`gh_token.sh` returned empty and all GitHub writes failed. The token itself is valid and
present (`op://Division/GH_TOKEN_CLASSIC`); the limit clears on its own. Next cycle (or a few
minutes later) just run the one command above. No Rez action required.
