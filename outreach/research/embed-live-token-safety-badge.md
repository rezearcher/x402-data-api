A static "audited" badge on a token page tells you what someone thought months ago. It cannot tell a holder that the contract added a pause function last week, or that liquidity drained yesterday. The badge is a photograph; the risk is a movie.

We just shipped the other kind: a live token-safety badge you embed once and it keeps telling the truth on its own.

## What it is

One endpoint returns a shields.io-compatible verdict for any Base ERC-20:

```
GET https://api.greyridgesignals.ai/chain/token/badge?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed
```

```json
{"schemaVersion":1,"label":"token-safety","message":"DEGEN: safe (risk 20/100)","color":"brightgreen","cacheSeconds":21600}
```

Drop it into any README, token page, or agent dashboard as a one-line embed:

```markdown
[![token-safety](https://img.shields.io/endpoint?url=https%3A%2F%2Fapi.greyridgesignals.ai%2Fchain%2Ftoken%2Fbadge%3Ftoken%3D0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&style=flat-square)](https://api.greyridgesignals.ai/check?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed)
```

It renders a green/yellow/red pill that re-checks the contract on its own and links back to the full report. Keyless. No account, no API key, no app to install.

## It checks the live contract, not a stored grade

Every verdict comes from the same on-chain analysis our paid swap gate runs: proxy and upgradeability, mint and pause and blacklist authority, and an on-demand transfer simulation to catch a token that takes your money but will not let you sell. The word is computed when the badge is asked, then cached for six hours, so a token that turns hostile flips from `safe` to `avoid` within that window without anyone touching the embed.

Four live verdicts pulled while writing this (2026-10-24):

| Token | Badge message | Color |
|-------|---------------|-------|
| WETH (no `?token=`, canary default) | `WETH: safe (risk 0/100)` | brightgreen |
| USDC | `USDC: caution (risk 65/100)` | yellow |
| DEGEN | `DEGEN: safe (risk 20/100)` | brightgreen |
| AERO | `AERO: safe (risk 15/100)` | brightgreen |
| `0x…dEaD` (not a contract) | `token: avoid (risk 100/100)` | red |

Note USDC lands on `caution`, not `safe`. That is honest: USDC carries legitimate admin controls (freeze, upgrade) that an automated reader cannot distinguish from a malicious one, so the gate flags them and lets you decide. A badge that painted every blue-chip green would be lying by omission.

## Where the free line is

The verdict word is free, because the red/green signal should be cheap and everywhere. That is what makes a badge spread. The detailed decode behind it is the paid product: the full flag list, the honeypot-simulation detail, the measured pool liquidity, and the trade-sizing output that tells your agent how large a position the pool can actually absorb. The badge is the doorway; `/check?token=` is the room.

GoPlus publishes an excellent token-security data API and covers more chains than we do. We are not trying to out-breadth them. Our wedge is narrower and sharper: a Base-native embed that runs the check on demand, returns a sizing number a trading agent can act on, and markets itself every time someone renders it. If you only need a red/green word, take it free. If your agent is about to size a trade against the pool, that is where we charge.

## Why an embed beats a dashboard

Distribution is the whole game. A dashboard you have to visit is a place people forget. A badge is a billboard that lives on the holder's own page and pays rent in trust. Every token project that embeds it is showing its holders a live safety signal and, in the same pixel, showing them who computes it. One embed, rendered a thousand times, is a thousand impressions we did not pay for.

## Try it

- Live badge for any Base token: `https://api.greyridgesignals.ai/chain/token/badge?token=<0x…>`
- Full free preview (paste any Base token): `https://api.greyridgesignals.ai/chain/token-security/preview?token=<0x…>`
- The paid gate with sizing: `https://api.greyridgesignals.ai/check`

This is a heuristic safety signal, not an audit and not a guarantee. A `safe` verdict means the automated checks found no blocking condition; it does not certify the contract or the team. Size your own risk.
