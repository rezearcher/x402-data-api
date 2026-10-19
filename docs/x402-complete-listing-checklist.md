# What a complete x402 listing looks like (and a free demo)

A measured study of 2,503 live x402 resources (dev.to/noboru, Oct 2026) found: median price $0.01, 87.8% of declared output schemas contain only `type` + `example`, and under 1% state liveness or what changed. Buyers (human and agent) pay blind.

Checklist we apply to Grey Ridge's endpoints:

1. **Real output contract** in the 402 `extensions.bazaar.schema` (field names, types, required) — not just an example.
2. **Free preview path** so a buyer can see the real response shape before paying:
   `curl 'https://api.greyridgesignals.ai/gate/swap/preview?token=degen'`
   `curl 'https://api.greyridgesignals.ai/chain/token-report/preview?token=weth'`
   (demo tokens: usdc, weth, cbbtc, aero, degen)
3. **Same-origin OpenAPI** with `x-payment-info` + `x-guidance`: `https://api.greyridgesignals.ai/openapi.json`
4. **Payment-required header mirrored in the 402 body** so v1 crawlers can parse it.
5. **Priced at the market point** ($0.01 gate/swap, $0.02 token-security, $0.05 token-report).

Use case: before an autonomous Base trading agent swaps into a token, call `/gate/swap` for a one-word GO / HOLD / BLOCK (honeypot sim, admin controls, pool-liquidity price impact). Example client: `docs/examples/swap-gate/gate.mjs`.

Contact: contact@greyridgesignals.ai
