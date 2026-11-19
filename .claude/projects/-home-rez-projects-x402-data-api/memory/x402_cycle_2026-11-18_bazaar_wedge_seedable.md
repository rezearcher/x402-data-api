---
name: x402-cycle-2026-11-18-bazaar-wedge-seedable
description: CDP Bazaar wedge-invisibility is settlement-gated (not metadata); all 7 wedge routes now one-command seedable, CDP facilitator already live, human-gated seed atom logged
metadata:
  type: project
---

# x402 CDP Bazaar — wedge routes made seedable; "metadata-only" fix FALSIFIED (2026-11-18)

**Constraint worked:** Line-A DISTRIBUTION — the differentiated trust/safety wedge is
invisible in the CDP x402 Bazaar (the catalog funded agents browse), so it can't be
discovered where it beats rivals. Live catalog (api.cdp.coinbase.com/platform/v2/x402/discovery/resources,
1000+ resources) lists only our **6 commodity routes** (/crypto/prices, /defi/yields,
/chain/storage-at, /ai/ask, /chain/allowance, /chain/receipt). **0 wedge routes.**

**FALSIFIED (primary source):** the inherited marketing claim — "(a) add bazaarResourceServerExtension
metadata so wedge routes list WITHOUT a prior settlement" — is WRONG.
https://docs.cdp.coinbase.com/x402/seller/get-discovered states verbatim: *"There is no
registration form or separate API call."* The discovery flow is declare metadata → validate →
**settle a paid call to get indexed**. Metadata alone (which every route already declares via
`declareDiscoveryExtension`) never lists a route. BAZAAR_SEED_STATUS.md + the code comment at
src/index.ts:4568 agree. DON'T rebuild a "settlement-free Bazaar lister" — it cannot work.

**CORRECTED a stale fear:** CDP facilitator is NOT gated on an unset key. Live `/x402/networks`
= `facilitator=cdp`, `source=cdp-facilitator-live`, `can_settle.base=true` (src/index.ts:2018-2039
sets that source only inside the `FACILITATOR_MODE==cdp && CDP_API_KEY_ID && CDP_API_KEY_SECRET`
block after an authenticated live CDP call returns supported networks). Secrets ARE set + working.
Resolved stale atom **b9b542c63a** ("set CDP key") with that evidence.

**Shipped (commit 4dc0631, local — not src/, no deploy):** the seeder `seed_endpoint.js`
hard-requires a `ROUTES[route]` entry (line ~364); only /chain/token-security of the 7 wedge
routes had one. Added the other 6 (metadata transcribed from each route's LIVE 402 body:
description ≤500 chars, serviceName, tags, input + queryParams inputSchema, representative output
example object). Added `--dry-run` / `DRY_RUN=1`: builds + signs the full CDP payload off-chain
and prints it but SKIPS the settle POST (zero funds). Verified: `node --check` clean; `--dry-run`
builds+signs valid payloads for ALL 7 wedge routes (prices 1000..1000000 wei, correct payTo
0x5765ae06...). Doc BAZAAR_SEED_STATUS.md updated with current reality.

**The real gate (human):** the actual seed moves on-chain USDC (`seed_endpoint.js` marked
Human-only; CLAUDE.md reserves on-chain capital for Rez). Buyer wallet 0xC4852c... holds **1.122
USDC**; all-7 cost **1.038 USDC** buyer→payTo (circular/recoverable, Base gasless — NO new capital).
Needs RAPIDAPI_PROXY_SECRET sourced locally (Worker secret, deliberately not in local env). Logged
human-gated atom **d05bc4125e** with exact preview→source→seed→verify steps.

**NEXT:** once Rez runs the seed, verify each wedge route appears in the live CDP discovery catalog
(recompute ~every 6h); that makes the wedge discoverable to funded agents = the first real test of
whether Bazaar visibility converts the differentiated routes. Does NOT confound open windows
(2f00fd0fbe measures x402scan coverage, not CDP Bazaar; revenue windows measure total_external_usdc).
See [[x402-cdp-bazaar-lists-only-commodity-routes-wedge-invisible]].
