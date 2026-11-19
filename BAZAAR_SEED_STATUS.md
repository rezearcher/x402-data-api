# Bazaar Seed Status

## CURRENT (2026-11-18, live-verified)

- **CDP facilitator is LIVE** — `/x402/networks` → `facilitator=cdp`, `source=cdp-facilitator-live`,
  `can_settle.base=true` (CDP_API_KEY secrets set + working on the deployed Worker; the "set CDP key"
  atom `b9b542c63a` was resolved as already-done).
- **CDP Bazaar listing requires a SETTLED paid call per route** — primary source
  (https://docs.cdp.coinbase.com/x402/seller/get-discovered): *"There is no registration form or
  separate API call."* Metadata alone never lists a route. The inherited "add metadata → wedge lists
  without settlement" idea is FALSE.
- **Live catalog** (api.cdp.coinbase.com/platform/v2/x402/discovery/resources): only **6 commodity
  routes** list (/crypto/prices, /defi/yields, /chain/storage-at, /ai/ask, /chain/allowance,
  /chain/receipt). **0 wedge routes** → the Line-A trust/safety differentiator is invisible where
  funded agents browse.
- **All 7 wedge routes are now one-command seedable** (`seed_endpoint.js`, this cycle): /x402/preflight,
  /x402/cert, /x402/receipt-verify, /chain/wallet-screen, /chain/token-security, /chain/token-report,
  /defi/yield-entry-verdict. `--dry-run` builds+signs each payload with zero funds moved (all 7 pass).
- **Buyer wallet** `0xC4852c26498d3187dEc2ce1b19e840710e302d1e` holds **1.122 USDC** on Base
  (Base x402 is gasless EIP-3009 — no ETH needed). Total cost to seed all 7 wedge = **1.038 USDC**
  (buyer→payTo, both ours, circular/recoverable; NOT revenue). **No new capital required.**
- **Gate:** the real seed run moves on-chain funds → `seed_endpoint.js` is marked Human-only.
  Human-gated atom **`d05bc4125e`** carries the exact runnable steps (preview → source
  RAPIDAPI_PROXY_SECRET → seed → verify).

## Routes with `declareDiscoveryExtension`

| Route | Price | Seed Status | Seed Script |
|-------|-------|-------------|-------------|
| `GET /pm/markets` | $0.005 | ✅ Seed attempted (check CDP Bazaar) | `seed_raw_cdp.js` |
| `GET /scan/mcp` | $0.10 | ❌ Needs wallet funding | `seed_raw_cdp_scan.js` |
| `GET /dns/:domain` | $0.01 | ❌ No seed script yet | — |
| `GET /chain/:action` | $0.01 | ❌ No seed script yet | — |
| `GET /enrich/:type` | $0.01 | ❌ No seed script yet | — |
| `GET /defi/lend` | $0.01 | ❌ No seed script yet | — |
| `GET /crypto/funding` | $0.01 | ❌ No seed script yet | — |
| `POST /mcp` | $0.005 | ❌ No seed script yet | — |

## Buyer Wallet

**Address:** `0xC4852c26498d3187dEc2ce1b19e840710e302d1e`
**ETH:** 0 ETH (needs ~0.0005 ETH for gas)
**USDC:** 0.002 (2,000 wei) on Base

## Funding Needed

To seed the scan route ($0.10 = 100,000 wei USDC on Base):
- 100,000 wei USDC (for settlement)
- ~0.0005 ETH (for gas)

## Module: `src/facilitator.ts`

- `createCdpFacilitator(apiKeyId, apiKeySecret)` → `HTTPFacilitatorClient`
  - URL: `https://api.cdp.coinbase.com/platform/v2/x402`
  - Auth: CDP JWT via `@coinbase/cdp-sdk/auth` `generateJwt`
- Called from `selectResourceServer()` in `src/index.ts` when `FACILITATOR_MODE=cdp`
- Import path: `import { createCdpFacilitator } from "./facilitator"`

## Secrets (wrangler.toml)

```toml
# === REQUIRED Worker secrets (set via `wrangler secret put <NAME>`) ===
# CDP_API_KEY_ID   - CDP API Key ID for JWT auth
# CDP_API_KEY_SECRET - CDP API Key Secret (PEM or base64)
```
