# Submit Grey Ridge to Circle Agent Marketplace (5 min, Google login required)

Why: Circle's curated catalog (agents.circle.com/services, 600+ services, Discovery API) is a USDC-native buyer surface. Listing is manual review via a Google Form that requires sign-in, so the agent cannot submit it.

Steps:
1. Open https://forms.gle/7YFzvdmMcn1JH5tF6 (sign in with any Google account).
2. Endpoint URL: https://x402-data-api.sigrunner.workers.dev  (use the workers.dev host — it is the canonical, always-200 origin; discovery: /.well-known/x402, OpenAPI: /openapi.json. The custom domain api.greyridgesignals.ai also serves 200 from datacenter IPs (the old 403 note was disproven 2026-10-21, see data/evidence/custom_domain_probe_2026-10-21.json), but keep the stable workers.dev host for Circle's health checks.)
3. Payout wallet: 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10 (Base, USDC)
4. Description (LEAD WITH THE CONVERTIBLE LANES — Circle lets buyers filter by category and first-reg likely freezes it; our only warm demand is COMPUTE + MARKET-DATA, token-safety is a free commodity that has not converted in 64 cycles):
   "Base-native x402 API, USDC per call, free previews. COMPUTE: OpenAI-compatible LLM inference (/v1/chat/completions, Llama-3.3-70B, keyless x402, $0.002/call, drop-in fallback lane). MARKET DATA: real-time crypto prices, on-chain token balances & reads, prediction-market data, token risk/honeypot reports. 20 paid endpoints, $0.001+/call, 99.92% measured uptime (2518 samples, GET /status)."
5. Submit. Review is manual; no further action.
Docs: https://developers.circle.com/agent-stack/agent-marketplace/get-listed

Rationale for the lane re-order (2026-10-21, cycle 65): token-safety/gate-swap pitches have been CLOSED/rejected by every GitHub integrator (fly.ai #13/#14, 16ane #81, TheBigBrother #9, polyrob, Haven — "GoPlus is free / Base-only"); the only positive reply in the whole corpus is the COMPUTE fallback lane (adexto #4). So the catalog description must lead buyers to compute + data, not token-safety.
