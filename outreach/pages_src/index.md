---
title: Base token safety API for AI agents (x402)
---
# Base token safety API for trading agents

Check a Base token **before** your agent buys it: honeypot sell-simulation, proxy/mint/pause/blacklist flags, measured transfer tax, liquidity depth. One HTTP call returns SAFE / CAUTION / AVOID.

- [Honeypot check API for Base tokens](honeypot-check-api-base.html)
- [Pre-trade safety gate for AI trading agents](pre-trade-safety-gate-ai-agents.html)
- [Pay-per-call, no API key: x402 token risk API](x402-token-risk-api.html)

Free sample (no wallet, no key):

    curl "https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview?token=0xYourBaseToken"

Paid route is the same depth: GET /chain/token-report?token=0x... at $0.01 USDC via [x402](https://x402.org) on Base. Swap guard /gate/swap returns GO / HOLD / BLOCK at $0.008.

Code: [greyridge-x402-tools](https://github.com/rezearcher/greyridge-x402-tools) (Python, LangChain, CrewAI, npx github:rezearcher/greyridge-x402-tools 0xTOKEN). Contact: contact@greyridgesignals.ai
