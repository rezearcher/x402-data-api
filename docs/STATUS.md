# Measured status (auto-generated 2026-11-05T14:59Z)

Source: `data/uptime_samples.jsonl`, 32920 samples from 2026-10-19T22:06:27.945628Z to 2026-11-05T14:58:02.790262Z, produced by `scripts/uptime_probe.py` hitting each free `/preview` path. Window is short; treat as a measurement, not an SLA.

| endpoint | samples | success | p50 ms | p95 ms |
|---|---|---|---|---|
| /chain/gas-price/preview | 4828 | 100.0% | 296 | 1276 |
| /chain/token-report/preview | 4828 | 99.5% | 1912 | 3423 |
| /chain/token-security/preview | 4828 | 99.6% | 1323 | 2625 |
| /crypto/funding/preview | 2166 | 99.2% | 2875 | 4050 |
| /crypto/prices/preview | 4828 | 99.8% | 301 | 1032 |
| /defi/yields/preview | 2166 | 98.9% | 408 | 773 |
| /gate/swap/preview | 4828 | 99.4% | 2070 | 3457 |
| /scan/mcp/preview | 4448 | 99.9% | 165 | 920 |

## Data correctness (canary probes)

Method: canary probes with proven negative controls (scripts/uptime_probe.py + canary_predicates.py); availability (HTTP 200) is NOT correctness. Point-in-time measurement, not an SLA. 'inconclusive' = the probe could not conclude (degrade-open), not a failure. Last checked: 2026-11-05T14:58:02.790262Z (fresh: True).

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
