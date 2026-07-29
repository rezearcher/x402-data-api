# x402 Agentic.Market Enrichment — Kanban t_1a11024d

**Status:** ⚠️ PARTIAL — seeder shipped; Agentic.Market enrichment itself **NOT** fixed
(card closed 2026-07-28; **doc corrected against the code 2026-07-29** — see "Corrections" below)

## Task Summary
Built a batch seeder (`seed_batch_cdp.js`) that seeds x402 data API routes into the Coinbase CDP
Bazaar catalog, and extended `seed_endpoint.js`'s registration table to cover `/chain/token-security`
and the full Base-RPC set. CDP Bazaar seeding is **upstream of** Agentic.Market's enrichment
pipeline — it does not itself populate `description`/`category` on the Agentic.Market record, which
is still empty (see status table below). That remains an open gap.

## Seeder Artifact
**`seed_batch_cdp.js`** — 237-line batch seeder at repo root. Code-verified features:
- Takes x402 challenge from each route, signs with buyer wallet, POSTs to `/internal/cdp-settle-raw`
  (route confirmed live at `src/index.ts:232`)
- Cooldown persistence (`.cdp_seed_cooldown.json`, 12h) prevents redundant on-chain txs; the entry is
  written **only after a non-error settle response** (`seed_batch_cdp.js:218`)
- Route manifest (hardcoded, `:21-109`) includes discovery metadata (description, tags,
  input/output schemas) matching each route's `declareDiscoveryExtension()` call
- **No CLI arguments.** Invoke as `node seed_batch_cdp.js` — there is no `--workers-url`,
  no `--dry-run`, and no `--route` filter (zero `process.argv` references in the file). The target
  host is hardcoded at `:15`. Every run attempts **real on-chain settles** for any route past its
  cooldown. For single-route seeding use `node seed_endpoint.js <route>` (positional arg,
  `seed_endpoint.js:158`), which covers 13 routes including token-security and all Base-RPC reads.

## Routes in the batch manifest
Four routes are in `seed_batch_cdp.js`'s manifest:
`/pm/markets`, `/chain/token-security`, `/chain/gas-price`, `/chain/block-number`.

**Seeding outcome — UNRESOLVED, do not cite either version as fact.** Two artifacts disagree:

| Source | What it says |
|---|---|
| `.cdp_seed_cooldown.json` | Success entries for **all four** routes, stamped 2026-07-28T15:09:31–34Z. Because the key is only set on the success path, this reads as 4/4 settled. |
| This doc's original table | `/chain/gas-price` and `/chain/block-number` seeded; `/pm/markets` and `/chain/token-security` **failed on insufficient USDC** (needed 5000 / 20000 wei, wallet had 2000). |

Unverified on-chain claim carried over from the card's own summary (**not** independently checked):
gas-price tx `0xb5ab7…33a` block 49,231,013; block-number tx sent but RPC returned null (pruned).

Re-run the seeder and capture the output to settle this.

**Key finding:** The live Worker (`x402-data-api.sigrunner.workers.dev`) uses **xpay facilitator mode** (`FACILITATOR_MODE = "xpay"` in wrangler.toml), NOT CDP. CDP Bazaar registration is **only** for Coinbase CDP Bazaar discoverability — routes are already operational via xpay facilitator for x402 payment flow. All routes return 402 Payment Required with valid x402 challenges.

## Wallet State
- **Buyer:** `0xC4852c26498d3187dEc2ce1b19e840710e302d1e`
- **USDC balance:** 2000 wei (0.002 USDC) — confirmed via eth_call at 2026-07-28T15:43Z
- **Needed for remaining routes:** 5000 wei (pm/markets) + 20000 wei (token-security) = 25000 wei total
- **Funding attempts:** Coinbase Faucet ❌ (all 5 attempts failed), FreeTesters ❌ (address policy restriction)

## Seeding Flow
1. **Route registration** — Each endpoint declares discovery metadata via `declareDiscoveryExtension()` in `src/index.ts`
2. **Challenge → Sign → Settle** — Batch seeder fetches x402 challenge, signs with buyer wallet, POSTs signed payload + Bazaar extension to `/internal/cdp-settle-raw`
3. **CDP verification** — Worker proxies to CDP facilitator's `/platform/v2/x402/verify` then `/settle`; settlement proof registers route in Coinbase CDP Bazaar catalog

## Agentic.Market Enrichment Status
Query at `GET https://api.agentic.market/v1/services/x402-data-api-sigrunner-workers-dev`:

| Field | Value |
|-------|-------|
| `enriched` | **False** — no Agentic.Market enrichment data yet |
| `description` | `""` — empty, not enriched |
| `category` | `""` — not categorized |
| Endpoints | 13 total, all listed with pricing and descriptions |

Route-level quality data (l30d):
- `pm/markets`: 5 calls, 1 unique payer ✅ (most popular, already receiving x402 payments)
- `defi/yields`: 2 calls, 2 unique payers ✅
- `block-number`: 2 calls, 1 unique payer ✅
- All other routes (gas-price, balance, code, tx, etc.): 1 call each ✅
- `token-security`: **None** — zero calls ever ❌ (highest price at $0.02 may deter initial usage)

All routes are listed in the Agentic.Market catalog and return valid x402 payment challenges via the live Worker. Enrichment metadata (descriptions, categories, tags) would need Agentic.Market's enrichment pipeline to process—this is separate from CDP Bazaar registration.

## Technical Detail

### Seeding Flow
1. **Route registration** — Each endpoint declares discovery metadata via `declareDiscoveryExtension()` in `src/index.ts` (lines 604, 634, 663, 692, etc.)
2. **Challenge → Sign → Settle** — Batch seeder initiates x402 payment challenge, signs with buyer wallet, POSTs to CDP facilitator's `/platform/v2/x402/verify` then `/settle`
3. **CDP Bazaar catalog** — Settlement proof registers the route in Coinbase's Bazaar discovery service (queried by Agentic.Market and other agents)

### Example Discovery Schema
Each route includes:
- **method**: GET
- **input**: Query parameters (e.g., `token` for token-security, `query` for markets)
- **output**: JSON response schema with example
- **pricing**: Exact USDC per call (0.001–0.005)
- **tags**: Searchable keywords (prediction-markets, token-security, gas-oracle, etc.)

## No Breaking Changes
- Endpoints remain **read-only** — no payload mutations on seeding
- Client behavior **unchanged** — existing payment flow works end-to-end
- Backward compatibility **preserved** — non-paying requests still get 402 challenge

## Next Steps (Future Sessions)
- Monitor Agentic.Market public catalog for service visibility (may take 1–2h post-seeding)
- If routes don't appear in catalog within 2h, check CDP facilitator logs for indexing errors
- Consider adding webhook listener on `/internal/cdp-settlement-confirmed` to auto-log successful registrations

## Corrections (doc-sync 2026-07-29, code-verified)

1. **CLI flags never existed.** `--workers-url` / `--dry-run` / `--route` were claimed but are absent
   from `seed_batch_cdp.js` (no `process.argv`). Corrected above.
2. **Timestamps were cooldown *expiry* times, not seed times.** The `03:09:32Z` / `03:09:34Z` values
   came from `seed_run_1785253314.log`'s `cooldown until 2026-07-29T03:09:3xZ` lines. That log is an
   **all-SKIP run** (`Seeded: none`). Actual seed times were ~12h earlier, 2026-07-28T15:09Z.
3. **Status downgraded ✅ COMPLETE → ⚠️ PARTIAL.** The card's headline goal — fixing the
   Agentic.Market enrichment gap — is not met: `enriched: False`, `description: ""`, `category: ""`
   per this doc's own status table, and there is no enrichment code anywhere in the repo.
4. **Insufficient-USDC failure rows flagged as contradicted**, not deleted — see the table above.

**Task ID:** t_1a11024d · deliverable rescued from `wt/t_1a11024d` via `ac53946` (work: `7627eaa`).
See `ARCHITECTURE.md` §12 for the code-level record.
