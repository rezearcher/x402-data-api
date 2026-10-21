# outreach: surplus-intelligence provider-listing ask
- channel: cold email (first contact)
- recipient: support@surplusintelligence.ai
- message-id: 1a15f3f5ef6f3b70
- date: 2026-10-21
- from: matthewjaybowman@gmail.com (signed Grey Ridge / contact@greyridgesignals.ai)
- ask: allowlist our keyless x402 OpenAI-compatible endpoint as a supply-side provider so Surplus router clients (surp-router, etc.) auto-route to it
- specs sent: POST /v1/chat/completions, llama-3.3-70b-instruct-fp8-fast, 0.002 USDC/call ($2.00/1k), Base eip155:8453, payTo 0x5765...ed10
- why qualified: Surplus is the AGGREGATION POINT feeding multiple cheapest-inference routers; it PAYS sellers USDC per served request (real revenue path, no capital/KYC/stake); compute = proven pay lane
- blocker named to them: offers require api_key + host-allowlist (~26 hosts); ours is keyless by design -> asked how to get host into GET /v1/providers
