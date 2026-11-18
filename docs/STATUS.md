# Measured status (auto-generated 2026-11-18T12:20Z)

Source: `data/uptime_samples.jsonl`, 62624 samples from 2026-10-19T22:06:27.945628Z to 2026-11-18T12:15:01.744526Z, produced by `scripts/uptime_probe.py` hitting each free `/preview` path. Window is short; treat as a measurement, not an SLA.

| endpoint | samples | success | p50 ms | p95 ms |
|---|---|---|---|---|
| /chain/gas-price/preview | 8541 | 99.6% | 320 | 3138 |
| /chain/token-report/preview | 8541 | 98.8% | 2235 | 5349 |
| /chain/token-security/preview | 8541 | 97.9% | 1418 | 4180 |
| /crypto/funding/preview | 5879 | 97.3% | 2970 | 3983 |
| /crypto/prices/preview | 8541 | 99.5% | 324 | 1016 |
| /defi/yields/preview | 5879 | 97.0% | 463 | 903 |
| /gate/swap/preview | 8541 | 98.4% | 2361 | 5696 |
| /scan/mcp/preview | 8161 | 99.4% | 190 | 830 |

## Data correctness (canary probes)

Method: canary probes with proven negative controls (scripts/uptime_probe.py + canary_predicates.py); availability (HTTP 200) is NOT correctness. Point-in-time measurement, not an SLA. 'inconclusive' = the probe could not conclude (degrade-open), not a failure. Last checked: 2026-11-18T12:15:01.744526Z (fresh: True).

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
