# On-chain buyer deanon via web3.bio — 2026-10-21

**Why:** goal-gate keeps naming `contacted->replied / improve targeting`. The best-qualified
prospect possible = a wallet already paying for exactly our product on our chain. The
onchain_demand_by_lane sensor names them. Prior cycles claimed deanon "infeasible from this
host (basescan/blockscout/ensdata 403)" — but never tried an identity-graph API.

**NEW (works from this host):** `curl https://api.web3.bio/profile/<addr>` returns ENS /
basenames / Farcaster / Lens identity. No 403. Used it on all 7 demand-lane buyers:

| addr | lane | calls | web3.bio identity | contact records |
|---|---|---|---|---|
| 0xf86e616ad996...b61f | token-safety | 33 (→onchainexpat) | none (bare) | — |
| 0x788b4ca1...8454 | token-safety | 11 | **ln-church.base.eth** | NONE (null desc/url/email/social) |
| 0xa19f6215...accc | token-safety | 3 | none | — |
| 0xd3fc4b47...3f0f | token-safety | 2 | **reztek.base.eth** | NONE |
| 0xc9c7b38c...1670 | token-safety | 1 | none | — |
| 0xec2abd3e...d034 | yields | 124 | none (bare) | — |
| 0x61d6b079...c9f3 | yields | 77 | none (bare) | — |

**Conclusion (durable dead-end):** on-chain buyers are UNREACHABLE by any channel we have.
The 2 basenames carry zero text records (no email/url/github/twitter); the rest are bare
addresses. Even the top token-safety buyer (0xf86e616a, 33 calls) spends only $4.95 total;
the whole token-safety lane is $5.16. Capturing 100% of observed on-chain demand ≈ a few
dollars — structurally can't reach $1000/day. **Stop attempting buyer deanon-to-contact.**
The $1000/day path is a volume INTEGRATOR (Haven/ArbiVault/Miles class), not spot buyers.

**Side findings:**
- Competitor token-safety sellers (onchainexpat, grokbot-hk, lanescrypt, losbeto, agentsvc)
  are all closed-source (no GitHub repo) → no adexto-style fallback wire-PR path.
- `scripts/competitor_buyer_targeting.py` is depth-blind: its local census
  (`buyer_seller_log.jsonl`, 3910 rows) shows 0xf86e616a→onchainexpat as **1** call, but
  Blockscout (onchain_demand_by_lane) shows **33**. So it will keep reporting
  "0 convertible depth buyers" regardless of real concentration. Low-EV to fix (targets are
  unreachable dust anyway), but don't trust its "0 convertible" as meaning no depth exists.

**Hottest live deal verified this cycle:** Miles/LiquidLogicX conversion path end-to-end live —
`examples/mcp-scan-preview.sh` serves 200 on raw.githubusercontent + runs clean on deepwiki
(3 tools, verdict clear); paste-mode detection fires on a poisoned tool (1 critical, risk 40,
verdict review, upsell → paid). Guard cron (`uptime_probe.py` `*/5`) green: scan_detection_ok=True.
Ball-in-court ("this week") — do NOT re-ping.
