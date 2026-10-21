Hi BlockRun team — I'm Matthew from Grey Ridge Signals (api.greyridgesignals.ai). We sell DeFi/market-data over x402 and I'd like to propose us for **Community Integrations**, mirroring the Predge proposal in #135.

Your routing catalog already covers LLMs, DEX data, prediction markets (Predexon), trading signals and stocks (Pyth). The gap we fill is the step *before* a trade routes: **is this Base token safe to touch right now?** You route the swap; nobody in the catalog answers honeypot / sellability / admin-control / liquidity-vs-notional. One call, one verdict — a natural pre-trade leg for ClawRouter agents.

All endpoints are x402 v2, **USDC on Base mainnet (`eip155:8453`)**, no account, no API key — settle straight from a wallet, exactly your model.

### Pre-trade safety (the catalog gap)

| Endpoint | Price | Result |
|---|---|---|
| `GET /gate/swap` | $0.008 | GO / HOLD / BLOCK pre-trade gate: honeypot + sellability, admin-control checks, Uniswap v3 liquidity vs. your notional — one decision + reason |
| `GET /chain/token-report` | $0.01 | SAFE / CAUTION / AVOID verdict + risk_score (0-100): honeypot sim, owner-renounced + mint/pause/blacklist/fee-setter/proxy checks, measured transfer tax, v3 WETH-pool liquidity (USD) |

### Complementary market data

| Endpoint | Price | Result |
|---|---|---|
| `GET /crypto/prices` | $0.001 | Spot token prices from DefiLlama, with a unix freshness timestamp |
| `GET /crypto/funding` | $0.004 | Cross-venue Hyperliquid + OKX + dYdX perp funding rates, top coins by 24h |
| `POST /scan/mcp` | $0.05 | Zero-egress security scan of an MCP server's advertised tools (tool-poisoning / prompt-injection, OWASP-mapped) |
| `POST /v1/chat/completions` | $0.002 | OpenAI-compatible chat (Llama 3.3 70B fp8), keyless x402 fallback lane |

- **Payment proof (live 402):** `curl -i "https://x402-data-api.sigrunner.workers.dev/gate/swap?tokenIn=0x4200000000000000000000000000000000000006&tokenOut=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&chainId=8453"` → `HTTP/2 402`, `payTo 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`, network `eip155:8453`, asset USDC. No account or key.
- **Discovery:** machine-readable manifest at `https://x402-data-api.sigrunner.workers.dev/.well-known/x402` (62 resources, x402 v2, serviceName + tags + price per route) and OpenAPI at `/openapi.json`. Listed on x402scan.
- **Reliability:** measured 99.92% success over 2518 samples (per-route p50/p95) at `GET /status`.
- **Already wired for you:** I've opened ClawRouter PR #503 adding `/gate/swap` as a `PARTNER_SERVICES` "Market data" entry — onboarding is a one-line server-side `proxyPath → host` map on your gateway, nothing to build.

Happy to shape pricing/paths to whatever fits BlockRun's margin model. Contact: contact@greyridgesignals.ai.
