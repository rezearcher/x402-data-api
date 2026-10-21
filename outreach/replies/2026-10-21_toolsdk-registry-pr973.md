# toolsdk-ai/toolsdk-mcp-registry — listing PR #973 (2026-10-21)

**Surface:** toolsdk-ai/toolsdk-mcp-registry (199★, 5096 MCP servers, site-backed at toolsdk-ai.github.io + mcpsdk.dev/toolsdk.ai, agent-discoverable via generated indexes/packages-list.json). Same fresh surface CLASS as cycle 69's mcpHQ PR #364 — site-backed MCP-server directory with a human+agent browse audience, distinct from the dead x402 registries.

**Action:** Opened PR #973 → https://github.com/toolsdk-ai/toolsdk-mcp-registry/pull/973
- Added single focused file `packages/finance-fintech/greyridge-x402-data.json` (remote MCP entry).
- `@toolsdk-remote/greyridge-x402-data`, Streamable HTTP → `https://x402-data-api.sigrunner.workers.dev/mcp`.
- Listed without `auth` per their "useful unauthenticated subset" rule; description states x402 pay-per-call (USDC/Base, $0.001–$0.05) + Base-only scope.
- Peer-matched to WealthVille (DeFi remote data server in same category).

**Verification before submit (metadata accuracy = contributor responsibility):**
- Live `/mcp`: initialize → protocol 2025-06-18; tools/list → 26 tools. ✅
- Identity unique on main (0 dup for greyridge-x402-data / sigrunner.workers.dev/mcp). ✅
- `node scripts/validate-registry.mjs --base origin/main` → 1 file, 0 errors, 0 warnings. ✅
- CI: Package Schema Check **pass** (12s); biome pending at submit.

**Status:** ball-in-court on maintainer review (they batch-merge focused schema-valid JSON PRs). Starred the repo (CONTRIBUTING-invited, aids our listing discoverability). Do NOT re-ping. Value = agent-discoverable listing in a 5096-server browse registry → discovery funnel to live paid /mcp.
