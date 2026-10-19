TO: founders@orthogonal.com
SUBJECT: Provider request: on-chain token-safety / pre-trade swap gate for Orthogonal's catalog
BODY:
Hi Orthogonal team — I went through your catalog (search, scraping, enrichment, market & social data). There is no on-chain token-safety / honeypot check, which is the first call a trading agent makes before swapping an unknown ERC-20.

Provider name: Grey Ridge Signals
Provider website: https://api.greyridgesignals.ai
API documentation: https://api.greyridgesignals.ai/openapi.json (manifest: /.well-known/x402)
What it does:
- GET /chain/token-report?token=0x… ($0.05): SAFE/CAUTION/AVOID verdict, live honeypot sell simulation, owner/proxy/mint/pause/blacklist/fee checks, Uniswap v3 liquidity, risk_score 0-100.
- GET /gate/swap ($0.01): go/hold/block pre-trade gate with price-impact vs notional.
Free live sample (no payment): https://api.greyridgesignals.ai/chain/token-report/preview

Happy to provide whatever schema/auth format you need. Settlement is x402 (USDC on Base); we can also take your standard provider split.
— Grey Ridge Signals (contact@greyridgesignals.ai)
