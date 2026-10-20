Hi, saw mcpchangefeed (and that your site already indexes our `ai.greyridgesignals/tech-risk` server). Idea that fits your "what changed" angle: a **security-change signal**. A changed tool description is the classic rug-pull vector, so a per-server "tool metadata changed + scan verdict" column would be new on a crowded directory.

We run a static tool-poisoning / prompt-injection scan of an MCP server's advertised `tools/list` (never calls tools). Free, no wallet:

    curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-SERVER/mcp"
    # or POST {"tools":[...]} to the same path for auth-gated servers

Returns tools scanned, issue counts by severity, risk score, verdict (clear/review/block). I just ran it over the 246 streamable-http remotes in the official registry: 109 readable without credentials (987 tools), 108 clear, 1 block. Method + raw rows: https://github.com/rezearcher/x402-data-api/blob/main/docs/MCP_REGISTRY_CENSUS_2026-10-20.md

Itemized findings with evidence are the paid call ($0.05, x402/USDC on Base); the preview is enough for a badge. Happy to shape the response to your dataset schema. No reply needed if not a fit.
