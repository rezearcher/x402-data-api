# Publish Grey Ridge MCP to Smithery (needs Rez login, ~2 min)
Why: Smithery registry lists other x402 MCP servers (compass, paycheck, dispatcher402...) but not ours (checked 2026-10-19). Agent devs browse it; it's a free discovery surface.
Steps:
1. `npx @smithery/cli@latest auth login` (browser OAuth).
2. https://smithery.ai/new -> add URL server: https://api.greyridgesignals.ai/mcp (streamable-http), name ai.greyridgesignals/tech-risk.
3. Description: "x402 pay-per-call: pre-trade swap gate, token safety, Base RPC, DeFi/Polymarket data (USDC)".
