# Measured status (auto-generated 2026-11-20T12:20Z)

Source: `data/uptime_samples.jsonl`, 67232 samples from 2026-10-19T22:06:27.945628Z to 2026-11-20T12:15:01.983311Z, produced by `scripts/uptime_probe.py` hitting each free `/preview` path. Window is short; treat as a measurement, not an SLA.

| endpoint | samples | success | p50 ms | p95 ms |
|---|---|---|---|---|
| /chain/gas-price/preview | 9117 | 99.6% | 311 | 3177 |
| /chain/token-report/preview | 9117 | 98.7% | 2325 | 5329 |
| /chain/token-security/preview | 9117 | 97.9% | 1425 | 4199 |
| /crypto/funding/preview | 6455 | 96.5% | 3001 | 4070 |
| /crypto/prices/preview | 9117 | 99.5% | 320 | 1012 |
| /defi/yields/preview | 6455 | 95.9% | 463 | 903 |
| /gate/swap/preview | 9117 | 98.0% | 2442 | 5719 |
| /scan/mcp/preview | 8737 | 99.3% | 188 | 816 |

## Data correctness (canary probes)

Method: canary probes with proven negative controls (scripts/uptime_probe.py + canary_predicates.py); availability (HTTP 200) is NOT correctness. Point-in-time measurement, not an SLA. 'inconclusive' = the probe could not conclude (degrade-open), not a failure. Last checked: 2026-11-20T12:15:01.983311Z (fresh: True).

| route | correctness | guards |
|---|---|---|
| /defi/yields | inconclusive | Returns real numeric APY/TVL rows (not an empty 200 from an upstream geo-block) |
| /crypto/prices | passing | Returns a live non-null USD price (guards the hollow-200 geo-block footgun) |
| /crypto/funding | inconclusive | Multi-venue funding rows stay numeric when a venue geo-blocks to null |
| /defi/yield-entry-verdict | inconclusive | Entry verdict keeps its APY/prediction substance, not a hollow label |
| /pm/markets | passing | Markets stay tradeable — numeric outcomePrices in [0,1], clobTokenIds present (no hollow-200 or cents-normalization bug) |
| /gate/swap | passing | A structural honeypot still blocks and a known-good token still passes (no false-SAFE) |
| /chain/token-report | passing | Honeypot screens AVOID, good token screens SAFE, DEX tax reads clean |
| /chain/token-security | passing | Metadata/sim decode correct on a known-good token (no fabricated risk) |
| /scan/mcp | passing | A poisoned MCP canary is still flagged (prompt-injection detection not regressed) |
