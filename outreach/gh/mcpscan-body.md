Your project checks MCP servers for tool poisoning / rug-pulls. Grey Ridge runs a pay-per-call MCP-scan endpoint (x402, USDC on Base, $0.05/call) that could sit next to yours as a second opinion or as an admission check for auth-gated servers you can't crawl (paste-mode: send the tool manifest, get findings back). We published a scan of 109 public registry servers (108 clean, 1 scanner false positive, since fixed): https://rezearcher.github.io/greyridge-x402-tools/mcp-registry-census-2026-10-20

Honest scope: it is a static manifest scanner with a small corpus (n=45), not a guarantee. Details and free preview: https://x402-data-api.sigrunner.workers.dev/llms.txt

If it would help, I can send a PR adding it as an optional backend or comparison in your README. Closing is fine if not.
