# Grey Ridge Signals — x402 DeFi & market-data API

Type: paid API (pay-per-call); not a facilitator. This is a submitted proposal for review, not a deployment or facilitator approval.

Application: https://github.com/X402blockchains/x402-registry/issues/16
Submitted: 21 October 2026 (UTC)

## Identity
- Operator: Grey Ridge Signals Group LLC
- Type: paid API; not a facilitator.
- Official website: https://greyridgesignals.ai
- Documentation / getting-started: https://x402-data-api.sigrunner.workers.dev/llms.txt (copy-paste `@x402/fetch` paid-call recipe); OpenAPI at https://x402-data-api.sigrunner.workers.dev/openapi.json
- Logo: https://greyridgesignals.ai/favicon.svg (HTTP 200; SVG)
- Live x402 manifest: https://x402-data-api.sigrunner.workers.dev/.well-known/x402
- Measured uptime: https://x402-data-api.sigrunner.workers.dev/status — 99.94% success over 1,670 probes (2026-10-19 → 2026-10-21). 5-minute free-preview probe; a measurement, not an SLA.
- Public support channel: contact@greyridgesignals.ai
- Ownership reference: the API is operated by Grey Ridge Signals Group LLC and referenced from the official website https://greyridgesignals.ai; GitHub operator `rezearcher`.
- Description: Pay-per-call DeFi and market-data for AI agents on Base. Live resources cover on-chain reads (ETH/BTC/USD Chainlink oracle prices, gas, block number, balances, token metadata), market data (crypto spot prices, perp funding, DeFi yields, prediction-market odds), and pre-trade safety (token risk reports, token security, swap-gate). All USDC on Base, x402 version 2, scheme `exact`.

## Verified unpaid discovery
`GET https://x402-data-api.sigrunner.workers.dev/chain/eth-usd` returns HTTP 402 with x402Version 2 JSON and a payment-required challenge. The scheme is `exact`.

| Network | Token | Atomic amount for /chain/eth-usd | Payment recipient |
|---|---|---|---|
| Base mainnet — eip155:8453 | USDC — 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals) | 1000 (0.001 USDC) | 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10 |

### Price-range correction (per review)
The review noted the application said prices start at $0.002 while `/chain/eth-usd` requests 1,000 atomic ($0.001). The accurate advertised range, aligned to the live catalogue:

Price range across the live catalogue: **0.001 USDC (1,000 atomic) to 0.05 USDC (50,000 atomic)**, USDC at 6 decimals.

| Route | Method | Price (USDC) | Atomic units |
|---|---|---|---|
| `GET /chain/eth-usd` — Base ETH/USD Chainlink oracle | GET | $0.0010 | 1,000 |
| `GET /chain/btc-usd` — Base BTC/USD Chainlink oracle | GET | $0.0010 | 1,000 |
| `GET /crypto/prices` — Multi-asset crypto spot prices | GET | $0.0010 | 1,000 |
| `GET /chain/block-number` — Base latest block number | GET | $0.0020 | 2,000 |
| `GET /chain/gas-price` — Base gas price | GET | $0.0020 | 2,000 |
| `GET /defi/yields` — DeFi yield/APY data | GET | $0.0010 | 1,000 |
| `GET /crypto/funding` — Perp funding rates | GET | $0.0040 | 4,000 |
| `GET /pm/markets` — Prediction-market odds | GET | $0.0050 | 5,000 |
| `GET /gate/swap` — Pre-trade swap safety gate | GET | $0.0080 | 8,000 |
| `GET /chain/token-report` — Token risk report | GET | $0.0100 | 10,000 |
| `GET /enrich/tech-risk` — Domain/tech risk enrichment | GET | $0.0100 | 10,000 |
| `GET /scan/mcp` — MCP server security scan | GET | $0.0500 | 50,000 |

Total live resources in manifest: **62**.

## Payments
- Paid endpoints and HTTP method: 19+ live GET routes (full list in the manifest). Representative prices above.
- Facilitator used: Coinbase CDP x402 facilitator — https://api.cdp.coinbase.com/platform/v2/x402 (production; `GET /health` reports `facilitator:"cdp"`). Fallback when CDP credentials are absent is xpay — https://facilitator.xpay.sh.
- Payment scheme / version: `exact`, x402 version 2.
- Token contract and decimals: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals, Base mainnet (eip155:8453).
- Receiving wallet: `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10` — merchant receiving address, not a facilitator signer/relayer.
- Successful settlement: paid settlement is live and verifiable on-chain. **Operator test settlement (labelled), Base mainnet:**
  - Tx: [`0x2821af0057408caf18c5034182ab63c5904e3dffbde0ecb89e92c76e860a7432`](https://basescan.org/tx/0x2821af0057408caf18c5034182ab63c5904e3dffbde0ecb89e92c76e860a7432)
  - Named resource: `GET /chain/token-report` tier — amount **0.01 USDC (10,000 atomic)**.
  - Decoded ERC-20 Transfer (USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`): `0xc4852c26498d3187dec2ce1b19e840710e302d1e` (operator buyer) → `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10` (merchant receiving wallet), **0.010000 USDC**.
  - Submitted by the CDP facilitator relayer `0xb87e1a2cc2b4643f2892768e80e41167f17c5860` via EIP-3009 `exact` scheme (merchant wallet is not the signer/relayer).
  - Block `52863233`, status `0x1` (success), timestamp `2026-10-20T17:03:33Z`.
  - Aggregate: `GET /metrics` reports 5,277+ settled paid calls across the catalogue, all routed through the CDP facilitator. No user counts invented beyond the public `/metrics` figure.

### Payment evidence vs. delivery evidence (per review point 1)
The settlement above is **payment** evidence. The **delivery** evidence — the actual resource result the paid `GET /chain/token-report` returns — is below, so the two are not conflated.

- **Payment link (settlement metadata).** On a paid `200`, the response carries header `X-PAYMENT-RESPONSE: <base64>`, which decodes to the receipt that ties *this* body to *that* on-chain payment:
  ```json
  { "success": true, "transaction": "0x2821af0057408caf18c5034182ab63c5904e3dffbde0ecb89e92c76e860a7432", "network": "base", "payer": "0xc4852c26498d3187dec2ce1b19e840710e302d1e" }
  ```
  The `transaction` field is the same tx independently verified above; `payer` is the operator buyer wallet. That header is how a buyer maps a delivered body back to its settlement.

- **Delivered resource result (`GET /chain/token-report`).** Representative `200 OK` body for the named resource, captured live `2026-10-22T00:47:19Z` from the identical route (free-preview path, documented as "same depth as the paid route"; the paid route differs only in removing the 3-token/IP/day cap and allowing any Base ERC-20). Nothing redacted — a token report contains no signatures, credentials or customer data:
  ```json
  {
    "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "chain": "base",
    "token_meta": { "symbol": "USDC", "name": "USD Coin", "decimals": 6 },
    "security": {
      "isHoneypot": false, "sellable": true,
      "transferTaxBps": null, "taxMutable": false,
      "ownerRenounced": false, "upgradeableProxy": true,
      "canMint": true, "canPause": true, "hasBlacklist": true,
      "simStatus": "tested"
    },
    "liquidity": { "wethPoolUsd": 157553051, "dex": "uniswap-v3", "pools": 4 },
    "verdict": "SAFE",
    "risk_score": 25,
    "reasons": [
      "owner can mint new supply",
      "contract can blacklist addresses",
      "transfers can be paused",
      "upgradeable proxy; logic can change after purchase"
    ],
    "analyzed_at": "2026-10-22T00:47:19.333Z",
    "disclaimer": "Heuristic risk signal, not financial advice or a guarantee."
  }
  ```
  (`liquidity.pools` is abbreviated to a count here; the full body enumerates each Uniswap-v3 pool with `fee_tier`, `pool` address and `weth_side_usd`.) This body is what the buyer receives in exchange for the settlement — i.e. the delivery evidence distinct from the payment evidence.

## Integration
1. Call the resource URL. On `402`, read `accepts[0]`: `scheme`, `network`, `asset`, `amount`, `payTo`, `maxTimeoutSeconds`, and `extra { name, version, decimals }` (the EIP-712 domain for USDC).
2. Build an EIP-3009 `exact` USDC transfer authorization for the quoted `amount` to `payTo` on Base; resend the request with the base64 `X-PAYMENT` header. Reference client: `@x402/fetch` — recipe at `/llms.txt`.
3. On success the API returns `200` with the JSON body and an `X-PAYMENT-RESPONSE` header carrying the settlement receipt (txHash, network, payer).
4. Free preview: every paid route exposes `/<route>/preview` returning a real sample with no payment, for wiring and testing.

### Timeout, uncertain settlement & result recovery (per review point 2)
A side-effect-free `GET` is safe to **re-request**, but it is **not** automatically safe to **pay for again** — signing a new authorization after a timeout is the one action that can double-charge. Correct handling:

1. **One call = one single-use authorization.** The `exact` EVM scheme is EIP-3009 `transferWithAuthorization`, which carries a unique `nonce` and a `validAfter`/`validBefore` window (bounded by the `402`'s `maxTimeoutSeconds`, 300s). It settles on-chain **at most once** — the nonce is consumed, so re-submitting the *same* signed `X-PAYMENT` cannot pay twice (a replay reverts on the used nonce).
2. **On a timeout or lost response, do not sign a fresh authorization.** First determine whether the prior authorization already settled:
   - If you captured `X-PAYMENT-RESPONSE`, read its `transaction` field and check that tx's status on Base.
   - Otherwise, query Base for a USDC `Transfer(from = your payer, to = payTo)` for the quoted `amount` within the authorization's `validBefore` window. (USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, recipient `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`.)
3. **If it settled** → the payment is complete; do not pay again. Recover the result by re-sending the **same** signed `X-PAYMENT` while it is still inside `validBefore` (standard clients such as `@x402/fetch` retain the authorization) — the route is deterministic and recomputes the body. If the window has already elapsed, the result is recoverable out-of-band: send the settlement tx hash to `contact@greyridgesignals.ai` rather than issuing a new paid call.
4. **If it did not settle** (no matching transfer, or `validBefore` has passed so it never can) → only then is it safe to sign a new authorization and retry.
5. **5xx / network errors before any `402` quote** carry no payment and may be retried freely. The rule is narrow: never sign a *new* paid authorization solely because a request timed out — confirm non-settlement first.

## Remaining before completed integration
- ✅ Base mainnet settlement transaction link + decoded receipt appended above (named resource `GET /chain/token-report`, 0.01 USDC, operator test, labelled).
- ✅ Review point 1 — delivered resource result for `GET /chain/token-report` added (section "Payment evidence vs. delivery evidence"), separated from the payment receipt.
- ✅ Review point 2 — retry/recovery guidance corrected (section "Timeout, uncertain settlement & result recovery"): never sign a fresh authorization after a timeout; confirm settlement first; recover a lost result via the same single-use authorization or the settlement tx.
- Applicant represents the project via the official website https://greyridgesignals.ai and this GitHub account.
- No historical volume, user count or ownership signature is claimed beyond the public `/metrics` figure. Figures appear only after a reliable public feed is connected.
