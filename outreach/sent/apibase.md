TO: admin@apibase.pro
SUBJECT: Provider listing: Base-native token-safety / pre-trade gate for APIbase (gap in your catalog)
BODY:
Hi — I searched apibase.discover for "token safety honeypot": the best match is CoinGecko token lookup. Your 1403-tool catalog has no on-chain honeypot/rug check, which is the first thing a trading agent needs before swapping an unknown ERC-20.

We run a keyless x402 API on Base (same USDC rail you settle on) that fills that gap:
- GET /chain/token-report ($0.05): SAFE/CAUTION/AVOID, live honeypot state-override sell simulation, proxy/owner/fee checks, Uniswap v3 liquidity, risk_score 0-100.
- GET /gate/swap ($0.01): go/hold/block pre-trade gate with price-impact vs notional.
- Free previews: https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview ; manifest /.well-known/x402 ; OpenAPI /openapi.json

Could you onboard us as a provider (proxy to our endpoints, we get paid per call to our wallet / your split — whatever your standard is)? I can send a JSON schema per tool in whatever format you need.
— Grey Ridge Signals (contact@greyridgesignals.ai)


SENT 2026-10-19T05:55Z via gmail-me msg 1a152b4ba6ad5399
