# RESOLVED/CORRECTED — we ARE in the CDP Bazaar; the leak was null tags/serviceName

**Original finding (2026-10-20 cycle ag): "absent from CDP Bazaar, 0 of 1000" — WRONG.**
That scan only read the FIRST PAGE (limit=1000) of a **27,809-item** pool.

## Corrected evidence (cycle 2026-10-20ak)
- Full paginated scan of `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`
  (28 pages, offset 0..27000): **we have 46 routes cataloged**, including the flagships
  /gate/swap, /chain/token-report, /chain/token-security. Discoverability is NOT the gap.
- The REAL gap: our cataloged entries had **`serviceName: null` and `tags: null`**, while every
  competitor (OnchainPulse, token-risk.com, HumanMirror, FortiSwap) sets a brand name + 5 keyword
  tags (["honeypot","rug-check","token-safety","evm","pre-trade"]). Buyers/routers search the 27.8k
  pool BY TAG and SERVICE NAME — so our routes were in the pool but invisible to search.
  OnchainPulse honeypot route: 57 calls / 10 payers / 30d. Ours: 8 calls / 2 payers (mostly canaries).

## Fix SHIPPED (commit ee24cd4, deployed, verified live)
`@x402/core` copies `routeConfig.serviceName` / `routeConfig.tags` into the 402 `resourceInfo` the
facilitator catalogs (chunk-YSNRPV3S.mjs:183-190; schema chunk-FPXAE3OS.mjs:17-19 — serviceName<=32,
<=5 tags each <=32 printable-ASCII). `makeRoutes()` (src/index.ts) now stamps
`serviceName:"Grey Ridge Signals"` + up to 5 curated/derived tags on every route. Verified live:
/gate/swap -> tags ["token-safety","honeypot","pre-trade","base","swap-gate"].

## ATOM: none (shipped, zero-capital)
Next cycle: after the CDP crawler re-catalogs (recheck the discovery pool for our serviceName/tags
populated), compare our quality.l30DaysUniquePayers vs competitors to see if tag-search lifts real calls.
