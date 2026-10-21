# OpenAPI reordered to lead with data lane — 2026-10-21 (cycle 35)

Gate: contacted->replied / "improve targeting". Demand lane fully ball-in-court
(adexto PR#5 open+owner "evaluating", ArbiVault PR#44 open, Haven closed/removed,
all 57 GH replies NO or in-court). Cold outreach forbidden (144 pulls, $0).
Code-search for NEW live-integration repos: all hits are crawlers/census/research
(tashan, meloliva14/x402-measure, romankurnovskii census paper) — zero new buyers.

So worked lane-B discoverability DEFECT instead: the OpenAPI (machine-import surface
scraped by x402scan, RapidAPI, MCP registry crawlers, aggregators like tashan) still
hard-coded /gate/swap + /chain/token-report FIRST, while the /.well-known/x402 surface
already led with the data lane. Evidence: only real non-sweep external payer bought
/defi/yields; token-safety pitch dead across 35+ integrator replies.

FIX (commit a1ed547, deploy run 39562617883 success, VERIFIED LIVE):
- src/index.ts:1365 paths `first` -> ["/defi/yields","/crypto/funding","/crypto/prices","/pm/markets","/gate/swap","/chain/token-report"]
- src/index.ts:1413 info.x-guidance -> leads with data routes, gate demoted
- Live openapi.json first 8 paths now: /defi/yields,/crypto/funding,/crypto/prices,/pm/markets,/gate/swap,/chain/token-report
- x402scan re-registers from source=openapi each refresh -> propagates automatically.

Durable, self-serve (no merge gate), evidence-backed, not a forbidden lever.
