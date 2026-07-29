# Bazaar Seed Status

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
