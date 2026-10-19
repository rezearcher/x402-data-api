# awesome-mcp-servers entry (ready to PR)

Target: punkpeye/awesome-mcp-servers, README.md, section "Finance & Fintech" (list is not strictly alphabetical; new entries are appended at the end of the section, after the last `- [` line before the next `### `).

Entry (one line; Glama page and badge verified HTTP 200):

- [rezearcher/x402-data-api](https://github.com/rezearcher/x402-data-api) [![rezearcher/x402-data-api MCP server](https://glama.ai/mcp/servers/rezearcher/x402-data-api/badges/score.svg)](https://glama.ai/mcp/servers/rezearcher/x402-data-api) 📇 ☁️ - Keyless pay-per-call (x402, USDC on Base) data for agents: crypto prices and funding, DeFi yields, Polymarket, Base on-chain reads including token balances and token-security scans, and MCP server security scanning. Free previews; includes a stdio client.

PR title: `Add x402-data-api (Finance & Fintech)`  (CONTRIBUTING: append `🤖🤖🤖` to the title for fast-track merge of agent PRs)
Body must end with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)

Notes: prior PRs #10277 (bad diff, non-GitHub URL, closed by maintainer as remote-only) and #10353 were closed; the scope rule is "GitHub repo you install and run yourself", so lead with the stdio client in mcp-client/.

BLOCKER: our fork (now rezearcher/amcs-old-fork, renamed) has a diverged main from July, so any branch pushed with the token is rejected: "refusing to allow an OAuth App to create or update workflow .github/workflows/check-glama.yml without workflow scope". Fix: re-issue the classic token with `workflow` scope (or delete_repo to drop the old fork and re-fork), then: branch from punkpeye main, insert the line, push, `gh pr create -R punkpeye/awesome-mcp-servers --head rezearcher:add-x402-data-api --base main`.
