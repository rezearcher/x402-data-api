# x402 Bazaar Market Analysis + Strategic Pivot — 2026-07-16

**Author:** session 2026-07-16 (evening). **Method:** pulled the public CDP Bazaar discovery
catalog (`https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, 4,000 of ~25.5k
HTTP resources) which exposes a per-listing `quality` object:
`{l30DaysTotalCalls, l30DaysUniquePayers, lastCalledAt}` = **real paid demand**. This is the
money map of the x402 economy. It supersedes guesswork in `PLAN.md` /
`GCP_EXECUTED_SCAN_PLAN.md` about where demand is.

## The headline finding

**Our MCP security scanner is in the single worst-performing category on the Bazaar.**

Demand-per-listing (d/s = sum of 30d calls+payers ÷ listings in category), sampled:

| Category | Supply (listings) | 30d demand | demand/listing |
|---|---:|---:|---:|
| search / scrape / web | 308 | 154,602 | **502** |
| social / identity | 220 | 100,629 | 457 |
| email / comms | 56 | 8,838 | 158 |
| crypto onchain-RPC | 352 | 39,541 | 112 |
| ai / llm | 188 | 13,737 | 73 |
| commerce / giftcard | 108 | 7,774 | 72 |
| image / media | 142 | 9,374 | 66 |
| finance / market | 483 | 31,051 | 64 |
| defi / token-price | 363 | 20,584 | 57 |
| geo / weather / ip | 272 | 11,793 | 43 |
| storage / upload | 74 | 2,323 | 31 |
| **security / scan** | **169** | **2,358** | **14 ← lowest** |

Security scanning: high supply (169 competitors), near-zero paid demand. Web search and
person/social data have ~35× the demand-per-listing.

## Two facts that rewrite the strategy

1. **99.3% of Bazaar listings earn paid calls** (3,972 / 4,000 sampled had >0 calls/30d).
   On the CDP Bazaar, *being listed in a live category IS the moat* — the discovery layer
   routes real agent traffic to catalog entries. This **reconciles our earlier
   "CVE-enrichment wrapper = structurally $0" verdict**: that SKU didn't fail on product; it
   failed because it was **off the Bazaar, in a dead category, uncatalogued**. Same commodity
   data, listed on the Bazaar in a hot category, earns (see BlockRun/Otto below).
2. **Only HTTP resources are indexed** (`type=http` = 25,516; `type=mcp` = 0). Pure-MCP
   endpoints are invisible in Bazaar discovery. Our paid **HTTP** routes (e.g. `GET /scan/mcp`)
   are the discoverable surface; the `/mcp` MCP endpoint is not.

## What agents actually pay for (top earners, 30d)

| Calls | Payers | Price | Service | What it sells |
|---:|---:|---:|---|---|
| 79,592 | 39 | $0.006 | x402.twit.sh | X/Twitter tweet search (whale buyers; **legal minefield — avoid**) |
| 42,079 | 321 | $0.01 | Tavily | Web search (broad, many payers) |
| 15,424 | 2 | $0.01 | Chainlink for Agents | onchain workflow exec (whale) |
| 9,543 | 273 | $0.01 | StableEnrich→Exa | neural web search |
| 7,235 | 2 | $0.01 | oneshotagent | people/contact discovery |
| 4,009 | 140 | $0.007 | Exa | web search |
| 3,985 | 2 | $0.001 | oneshotagent | email deliverability check |
| ~9k (suite) | 40–120 ea | $0.001–0.003 | **Otto AI** | crypto news/sentiment, funding-rate arb, hyperliquid, yield, KOL, trending |
| ~4k (suite) | 23–42 ea | $0.0095 | **BlockRun.AI** | Polymarket / Kalshi / mindshare queries |
| 1,812 | 78 | $0.28 | StableEnrich→PDL | person enrichment (PII — legal-grey) |
| 881 | **873** | $0.01 | CuseTheJuice | **agent email** (most unique payers on the Bazaar) |

**Read:** broad, legally-clean, distributed demand lives in (a) **web search/content**,
(b) **agent email/comms** (huge adoption, thin supply), (c) **crypto & prediction-market data
suites** (Otto, BlockRun) — priced $0.001–0.01, sold as *many cheap endpoints*. The mega-earners
by raw calls are whale-fed (2 payers) or legally toxic (X scraping).

## The committed pivot

**From:** polish one MCP-security-scanner (deadest category).
**To:** **Bazaar-first portfolio.** Get on the CDP Bazaar and ship endpoints into
proven-demand, legally-clean categories that match our edge. Many cheap endpoints = convex
at-bats (bounded downside, each a shot at the first dollar).

Category picks (edge × proven-demand × barbell-clean):
- **Crypto / DeFi market-data suite** — Otto AI model. Free public sources (Hyperliquid, Aave,
  Morpho, DefiLlama, etc.). We have Midas, `finance-*` skills, PM sensors. Clean (market data,
  no PII). Naturally a suite.
- **Prediction-market data** — BlockRun model. Free public APIs (Polymarket gamma/clob, Kalshi).
  We have the `polymarket` skill + the `pm_divergence` sensor. Proven demand, clean.
- **NOT:** X/Twitter or people-PII enrichment (legal minefield / unbounded downside — barbell veto).
  **NOT:** more security-scanner build (dead category; keep the current one live as free upside).

Do **not** sell Midas/Numerai *alpha* itself (alpha-suppression rule) — sell commodity-but-demanded
market **data**; the Bazaar distribution is the moat, not the data.

## Build plan (staged, to first dollar)

1. **CDP Bazaar on-ramp** (required for ALL our x402 services): wire the CDP facilitator into the
   Worker so settlements go through CDP and routes get catalogued. `HTTPFacilitatorClient({ url,
   createAuthHeaders })` — CDP facilitator `https://api.cdp.coinbase.com/platform/v2/x402`, JWT
   bearer signed from `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` (Worker secrets, confirmed set) via
   WebCrypto (detect key format: ES256 PEM vs Ed25519 base64). Keep xpay as fallback behind a flag.
   Confirmed viable: Bazaar issue #2112 (Base-mainnet HTTP indexing) closed 2026-07-16 — mainnet
   HTTP routes catalog within ~1 min of first declaration-carrying settle.
2. **First high-demand endpoint(s):** add one clean crypto/PM data route (e.g. Polymarket markets
   query, or crypto funding-rate/yield) with `declareDiscoveryExtension`. Price $0.001–0.01.
3. **Seed one CDP settlement** for that route → catalogs us in the Bazaar (self-pay; USDC
   self-transfer is allowed by the token contract; verify CDP facilitator accepts from==to,
   else fund a throwaway buyer wallet with <$1).
4. **Measure** via the `quality` object (l30DaysTotalCalls) — the revenue monitor already watches
   the wallet. First paid call in a live category is the tripwire.
5. **Expand** the suite (L6): each new endpoint = new route + declaration, near-zero marginal build.

## Status of the existing scanner (unchanged, still live)
- MCP Registry v1.1.0 (scanner description, latest), public repo
  `github.com/rezearcher/mcp-security-scanner`, Smithery
  `grey-ridge-signals-group/mcp-security-scanner`. Keep as free upside; **no further build cycles.**
