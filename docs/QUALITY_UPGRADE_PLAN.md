# Quality Upgrade Plan — make all 15 endpoints best-in-class

**Source:** 3 empirical competitor audits (2026-07-16), curling our real outputs vs. top x402
competitors (AgentData, Crest, Askew, DevDrops, OneSource, LoneStarOracle, GlobalAPI, GPT55) + raw
free upstreams. All line numbers refer to `src/index.ts`. Raw audit pulls (this session only):
`scratchpad/audit/*.json`, `scratchpad/onesource_openapi.json`.

**Headline:** two of our paid *security* products ship **false/misleading output** (correctness bugs),
and most data endpoints are thin passthroughs that discard high-value fields **already present in
payloads we fetch**. Fixing is cheap (mostly zero-new-dependency normalization). Competitive moat:
OneSource (the 340–416-payer RPC leader) is **Ethereum-only with no price oracle** → **Base + USD
fields are structurally ours**; nobody offers **Basenames** resolution or **MCP-server security
scanning** on x402.

**Pricing is NOT a constraint** — we're at/below every competitor on all four data endpoints, so
richer fields ship without price changes and widen the value gap.

---

## PHASE 0 — P0 CORRECTNESS BUGS ✅ DONE 2026-07-16 (commit `db173e7`, deployed `359b027a`)

> All 5 fixes implemented + **verified live** (scan/mcp: context7 `2 tools/risk 100` & hf.co `4/20`
> vs old `0/Clean`, and a non-MCP target now errors instead of false-"Clean"; funding 3 non-null via
> dYdX; EIP-7702 byte-exact on vitalik.eth Base addr; 117 subdomains vs 3; exploit_available derived).
> Independent verifier caught + we fixed a fallback-path false-"Clean" hole before commit. tsc clean.


1. **`/scan/mcp` false "clean" verdict** — `scanMcpServer` (~2293–2335) POSTs a bare `tools/list`
   with **no MCP `initialize` handshake and no `Mcp-Session-Id`**. Spec-compliant servers (confirmed
   live: `mcp.context7.com/mcp`, `hf.co/mcp`) reject it → error swallowed → returns
   `tools_scanned:0, risk_score:0, "Clean"`. A maximally-poisoned server scores identical to a safe
   one. **FIX:** do the streamable-HTTP handshake — POST `initialize` (protocolVersion 2025-06-18,
   clientInfo), capture the `Mcp-Session-Id` response header + the `InitializeResult`, send
   `notifications/initialized`, then `tools/list` **with the session header**. Fall back to the
   current stateless path only if the server doesn't require a session. **Verify fix live against
   context7 + hf.co (both broken today) and deepwiki (works today).** This is the #1 fix in the repo.

2. **`/enrich/tech-risk` `exploit_available` is hardcoded `false` forever** (~line 1203). A security
   field that lies for every CVE incl. KEV/actively-exploited. **FIX:** compute
   `exploit_available = in_kev || epss >= 0.5` (data we already have), or remove the field.

3. **`/enrich/domain` crt.sh dedup by `issuer_name`** (`searchCertificates`, ~1403–1435) collapses
   subdomain enumeration (the whole point of crt.sh) to ≤10 arbitrary entries. **FIX:** dedup by
   `name_value`, raise `limit` (e.g. 200), emit a distinct **`subdomains: string[]`** (unique
   hostnames). Repairs a capability the README already advertises.

4. **`/chain/code` + `/chain/wallet` mislabel EIP-7702 delegated EOAs as `is_contract:true`**
   (~line 2182: `code !== "0x" && code.length > 2`). Confirmed live on vitalik.eth's Base address
   (bytecode `0xef0100…` = 7702 delegation designator). **FIX:** if code starts with `0xef0100`,
   return `is_contract:false, is_eip7702_delegate:true, delegate_address:0x<next 20 bytes>`; else
   real contract. **First-to-market — OneSource (ETH-only) doesn't handle this.**

5. **`/crypto/funding` advertises 4 venues, 2 are dead** — Bybit (HTTP 403 CloudFront geo-block) +
   Binance (HTTP 451 restricted) are blocked from Cloudflare Workers edges (`fetchFundingRates`
   ~1704–1726) → always `null`. **FIX:** either route Bybit/Binance via a proxy region OR swap for
   venues that don't CDN-block Workers (dYdX, Aevo, Vertex, Kraken futures) OR narrow the openapi
   claim to the venues that actually work. Don't advertise a 4-venue product that's usually 2-venue.

---

## PHASE 1 — ZERO-DEPENDENCY FIELD ENRICHMENTS ✅ CORE DONE 2026-07-16 (commit `547dc1c`, deployed `17ca8722`)

> Items **6, 7, 8, 9, 12 DONE** + verified live (change_24h; funding premium/annualized/signal/next_funding_ts;
> defi mu/sigma/pool/risk_adjusted; pm/markets bestBid/ask/spread/volume24hr-sort/tags + new /pm/markets/preview
> [20 MCP tools]; token-balance symbol/decimals/balance_formatted). **Remaining: 10 (receipt fields), 11 (tx
> normalize), 13 (tech-risk fields), 14 (verdict enum — folded into Builder D).**


6. **`/crypto/prices`** (VERDICT: behind — every competitor adds ≥1 derived field, we add zero;
   handler ~1945–1985): add **`change_24h`** via parallel `GET coins.llama.fi/percentage/coingecko:{ids}?period=24h`
   (same host, keyless). [P1] add `market_cap`,`volume_24h`,`change_7d` via CoinGecko free
   `api.coingecko.com/api/v3/simple/price?ids=&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`
   (behind a short Workers cache — unauth ~10–30 req/min).

7. **`/crypto/funding`** (ahead on structure; `fetchFundingRates` ~1704–1726): surface **`premium`**
   (basis — already in the Hyperliquid `assetCtx` payload we parse, currently discarded), derive
   **`annualized_hl`** (`funding×24×365`) + **`annualized_okx`** (`funding×3×365`), **`signal`** enum
   (`LONGS_PAY|SHORTS_PAY|NEUTRAL`), **`next_funding_ts`** (OKX response already has `nextFundingTime`),
   and `prevDayPx` (HL payload). All zero new fetches. Closes the AgentData `annualized`+`signal` gap.

8. **`/defi/yields`** (at-par; `fetchDefiYields` ~1855–1902): add from the same DefiLlama
   `yields.llama.fi/pools` payload — **`pool`** (UUID, stable id to track a pool), **`outlier`**
   (DefiLlama anomaly flag), **`rewardTokens`** (which token pays apyReward — reward APY is
   meaningless without it), **`apyPct1D`**, **`mu`/`sigma`** (enable `sort=risk_adjusted` = `apy/sigma`;
   **no competitor exposes mu/sigma**), `underlyingTokens`, `apyBase7d`, `apyMean30d`, `il7d`.

9. **`/pm/markets`** (VERDICT: weakest endpoint; handler ~1553–1617): the gamma `/markets` object has
   67 fields, we keep 8. Add **`bestBid`,`bestAsk`,`spread`** (real tradeable price vs last-trade
   `outcomePrices`), **`volume24hr`** (+ `volume1wk`), **`oneDayPriceChange`**, **`clobTokenIds`**
   (needed to actually trade), **`conditionId`**. **Switch default sort → `order=volume24hr`** (not
   lifetime `volume`, which lets dead markets outrank live ones). Add category/**`tags`** by fetching
   `gamma-api.polymarket.com/events?closed=false&order=volume24hr&limit=N` (strict superset in one
   call — returns `tags[].label` + nested `markets[]`). **Add a free `/pm/markets/preview`** (only
   data endpoint without one — hurts trust). [P2] add Manifold (`api.manifold.markets/v0/markets`,
   free) as optional `?source=polymarket,manifold` to beat DevDrops' dual-source.

10. **`/chain/receipt`** (~2141–2160): pass through fields already in the raw `eth_getTransactionReceipt`
    response we discard — **`l1Fee`,`l1GasPrice`,`l1GasUsed`,`effectiveGasPrice`,`cumulativeGasUsed`,
    `contractAddress`, full `logs[]`** (keep `logs_count` too). Base L1-fee breakdown an ETH-only
    competitor can't offer.

11. **`/chain/tx`** (~2110–2122): normalize consistently (currently mixed hex/decimal). Add `status`
    (needs a receipt call or note), `value_eth`, `gas_price_gwei`, and keep hashes as hex. Consider
    decoded 4-byte selector.

12. **`/chain/token-balance`** (the single worst gap — returns bare `balance_raw`): add **`symbol`,
    `decimals`, `balance_formatted`** via 2 extra `eth_call`s (`symbol()` `0x95d89b41`, `decimals()`
    `0x313ce567`), cache per token contract. Most-called RPC primitive; unusable without this.

13. **`/enrich/tech-risk`**: `fetchEpss` (~1212–1232) keep **`percentile`** (top-1% messaging — same
    response). `searchNvd` (~1173–1209) parse **`published`/`lastModified`**, **`weaknesses[].description`**
    (CWE id), **`references[].url`** (we surface zero links today), **`cpeMatch[].versionStartIncluding/
    versionEndExcluding`** (affected-version ranges = "am I affected"). Zero new API calls. [P2] request
    a free NVD API key (5→50 req/30s) to avoid silent throttling under concurrent traffic.

14. **`verdict` enum on all 3 security endpoints** — every competitor (LoneStarOracle, GlobalAPI,
    GPT55) ships `PASS/WARN/BLOCK`-style; we ship only a numeric score. Add `verdict: "clear"|"review"|"block"`.

---

## PHASE 2 — USD ENRICHMENT (internal cross-call to our own `/crypto/prices` — the moat OneSource can't match)

15. **`/chain/gas-price`**: add EIP-1559 **`base_fee_gwei`/`priority_fee_gwei`** via `eth_feeHistory`,
    plus **`gas_price_usd`** (ETH price × gas). OneSource has no price oracle → can't match.
16. **`/chain/balance` + `/chain/wallet`**: add **`balance_usd`** (internal price cross-call).
17. **`/chain/receipt`**: add **`l1_fee_usd`** + total-fee-usd.

Implementation: a small internal `getEthUsd()`/`getTokenUsd()` helper reusing `fetchTokenPrices`,
cached in-isolate with short TTL. Don't make paid sub-calls — reuse the fetch fns directly.

---

## PHASE 3 — NEW UNCONTESTED ENDPOINTS (Base-native, zero x402 competitor coverage)

18. **`/chain/basename?address=` / `?name=`** — Basenames forward+reverse resolution. L2Resolver
    `0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA`, ReverseRegistrar `0x876eF94ce0773052a2f81921E70FF25a5e76841f`
    on Base mainnet. **ZERO competitor coverage anywhere on x402** (OneSource is ETH-only; Basenames
    don't exist on ETH). Highest-leverage new build. Verify resolver ABI/flow before coding.
19. **`/chain/token-info?token=`** — name/symbol/decimals/totalSupply + `supportsInterface` classify
    ERC20/721/1155 (mirrors OneSource `contract/{address}`, most-used-before-any-token-interaction).
20. **`/chain/events`** — `eth_getLogs` wrapper (contract/topic/from_block/to_block). Biggest capability
    gap; unlocks monitoring/activity feeds/security scanning.
21. **`/chain/token-transfers`** (decoded ERC-20 Transfer feed, built on #20), **`/chain/nft-owner`**,
    **`/chain/nft-metadata`** (IPFS-resolved), **`/chain/allowance`** (pairs w/ our security line),
    **`/chain/proxy`** (EIP-1967/UUPS/Transparent detection — security-brand fit).
22. **`POST /chain/multicall`** — array of `{to,data}` reads, one payment for N. Beats OneSource's
    per-call-only pricing on cost for portfolio scans.
23. Round-out parity (lower priority): `/chain/block?number=`, `/chain/nonce`, `/chain/call`,
    `/chain/estimate-gas`, `/chain/storage`, `/chain/pending`.

---

## PHASE 4 — SECURITY DEEPENING (`/scan/mcp` is an uncontested x402 niche — worth investing)

24. After the Phase-0 handshake fix: also analyze **`InitializeResult.instructions`** (free-text,
    same attack surface as a tool description — already fetched in the handshake) as a synthetic
    "(server instructions)" tool. Also scan **`resources/list`** + **`prompts/list`** (matches Cisco/
    Invariant surface coverage) — not just `tools/list`.
25. Expand `analyzeMcpTool` regex breadth (~2248–2282) — paraphrase/translation-resistant patterns;
    current rules only catch verbatim-English injection.
26. [Roadmap, needs KV] rug-pull/tool-pinning: hash tool descriptions per target, flag drift across scans.
27. Cite **CVE-2025-54136 (MCPoison)** + **CVE-2025-54135 (CurXecute)** as the named vuln class in
    docs/marketing (more credible than "OWASP LLM01/LLM08" alone).

---

## PHASE 5 — DOCS / COPY FIXES

28. Stop calling `/enrich/domain` **"firmographic"** — it's DNS + registration + certificate
    enrichment, not company data (fixing real firmographics needs paid data → breaks keyless model).
    Update README + openapi + manifest descriptions.
29. Update README/openapi/llms.txt/manifest/MCP-tool descriptions to reflect all enriched shapes +
    new endpoints (keep them in lockstep — every prior build updated all surfaces together).

---

## POST-BUILD (after each phase deploys)
- `npx tsc --noEmit` clean, `wrangler deploy`, `node smoke.js "<path?q>"` to verify each new/changed shape.
- **Re-register on the working directories** (they read our openapi): `node register_x402scan.js`
  (SIWX), re-`POST 402index.io/api/v1/register` for changed endpoints, and re-publish MCP Registry if
  descriptions change. CDP Bazaar listing examples are stale — optional re-seed via `seed_endpoint.js`.
- Update Division memory + this doc's status as phases land.

## BUILD SEQUENCING (next context window)
Single file (`src/index.ts`) → run builders **sequentially**, not parallel (avoid conflicts):
1. **Builder A — Phase 0 (correctness bugs)** — highest priority, fixes misleading paid output. Verify each live.
2. **Builder B — Phase 1 (data-endpoint enrichments)** — the 4 data endpoints + receipt/tx/token-balance.
3. **Builder C — Phase 2 + Phase 3 (USD + new /chain endpoints incl. Basenames)**.
4. **Builder D — Phase 4 (security deepening) + Phase 5 (docs)**.
Deploy + smoke + re-register after each builder. Each builder: mirror existing patterns, tsc clean,
update all discovery surfaces (makeRoutes declareDiscoveryExtension example, manifest mk(), llms.txt,
openapi paths, MCP tool) in lockstep.
