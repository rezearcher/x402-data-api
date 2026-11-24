# Measured status (auto-generated 2026-11-24T12:20Z)

Source: `data/uptime_samples.jsonl`, 76448 samples from 2026-10-19T22:06:27.945628Z to 2026-11-24T12:15:01.942262Z, produced by `scripts/uptime_probe.py` hitting each free `/preview` path. Window is short; treat as a measurement, not an SLA.

| endpoint | samples | success | p50 ms | p95 ms |
|---|---|---|---|---|
| /chain/gas-price/preview | 10269 | 99.6% | 296 | 3226 |
| /chain/token-report/preview | 10269 | 98.7% | 2488 | 5245 |
| /chain/token-security/preview | 10269 | 98.1% | 1410 | 4168 |
| /crypto/funding/preview | 7607 | 95.6% | 3053 | 4087 |
| /crypto/prices/preview | 10269 | 99.6% | 307 | 987 |
| /defi/yields/preview | 7607 | 93.9% | 451 | 877 |
| /gate/swap/preview | 10269 | 97.7% | 2579 | 5599 |
| /scan/mcp/preview | 9889 | 99.1% | 180 | 782 |

## Data correctness (canary probes)

Method: canary probes with proven negative controls (scripts/uptime_probe.py + canary_predicates.py); availability (HTTP 200) is NOT correctness. Point-in-time measurement, not an SLA. 'inconclusive' = the probe could not conclude (degrade-open), not a failure. Last checked: 2026-11-24T12:15:01.942262Z (fresh: True).

| route | correctness | guards |
|---|---|---|
| /defi/yields | passing | Returns real numeric APY/TVL rows (not an empty 200 from an upstream geo-block) |
| /crypto/prices | passing | Returns a live non-null USD price (guards the hollow-200 geo-block footgun) |
| /crypto/funding | passing | Multi-venue funding rows stay numeric when a venue geo-blocks to null |
| /defi/yield-entry-verdict | passing | Entry verdict keeps its APY/prediction substance, not a hollow label |
| /pm/markets | passing | Markets stay tradeable — numeric outcomePrices in [0,1], clobTokenIds present (no hollow-200 or cents-normalization bug) |
| /gate/swap | passing | A structural honeypot still blocks and a known-good token still passes (no false-SAFE) |
| /chain/token-report | passing | Honeypot screens AVOID, good token screens SAFE, DEX tax reads clean |
| /chain/token-security | passing | Metadata/sim decode correct on a known-good token (no fabricated risk) |
| /scan/mcp | passing | A poisoned MCP canary is still flagged (prompt-injection detection not regressed) |
