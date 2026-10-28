# Production verification — token-report honeypot `simStatus` (card t_4147c280)

Acceptance under test: after deploying the balance-slot detection fix, the paid
`/chain/token-report` returns `"simStatus":"tested"` for a real token instead of
`unavailable` / `detection-miss`.

Verdict: **met, and met on the paid route itself** — not just on a preview alias.
One genuine defect found alongside it (paid routes reject the demo aliases their own
402 manifest advertises) is written up at the end and filed as its own card.

## Deployment state (verified, not re-deployed)

| fact | value |
|---|---|
| live version | `77d2ca38-95f0-4085-a9a2-73eecdd9f2ef` at 100% |
| deployed | 2026-10-28T06:43:48Z (preceding deploy 06:38:34Z) |
| repo HEAD at verification | `main` @ `a47ea67` |
| fix commits present in HEAD | `51751a0` (wide-slot 0..63 + ERC-7201 namespace), `061c2f3` (gate arg validation) |
| commits **not** in HEAD | `4c122cd`, `49eac71` (slot cache + `simFailReason`, branch `t_9daf3d13`) |

`wrangler deployments list` reports version UUIDs with an empty message, so the deployed
SHA cannot be read directly. It is inferred **behaviourally**: two post-`51751a0` /
post-`061c2f3` behaviours are observable in production (a slot-51 token resolving to
`tested`, and `/gate/swap/preview` returning 400 on a malformed `side` without burning a
trial check). No source-side drift remains between `main` and production for this fix —
the uncommitted tree entries (`src/index.ts`, `src/status_snapshot.ts`) belong to a
concurrent worker and are unrelated to slot detection.

## Evidence — production, live

| surface | token (layout) | HTTP | `simStatus` | note |
|---|---|---|---|---|
| paid `/chain/token-report` | USDC `0x8335…` (slot 9) | 200 | `tested` | settled on-chain, tx `0x4b93949edde8241ca7c392476e63d9ee20d958be757ac11959e177b5797f07f2` |
| paid `/chain/token-report` | cbETH `0x2Ae3…` (**slot 51**) | 200 | `tested` | **the decisive one** — a 0..15 window cannot find slot 51 |
| `/chain/token-security/preview` | USDC | 200 | `tested` | `slot 9`, `slot_layout mapping@slot9`, `transferable true` |
| paid `/chain/token-report` (unpaid) | USDC | 402 | — | manifest prices 0.01 USDC on `eip155:8453`, aliases resolved to the address in `queryParams` |
| paid `/chain/token-report` | `token=USDC` (alias) | **400** | — | `token query param must be a 0x-prefixed 20-byte address`; **not charged** |
| `/chain/token-security/preview` | USDbC, cbETH | 429 | — | trial cap; fails closed with "this is NOT a result for the token you asked about" |

cbETH is the load-bearing sample: its balance mapping sits at slot 51, outside the old
0..15 candidate window. `tested` on the paid route therefore proves the wide-window
candidate set is running in production, not merely committed.

## Stability window (post-deploy)

Active synthetic monitoring, 06:55:20Z → 06:58:11Z, 9 samples, 20 s apart:

- paid route without payment: **9/9 → 402** (middleware healthy, no 5xx)
- `/chain/token-security/preview?token=usdc`: **9/9 → 200, `sim_status: tested`**

No 5xx observed across the window. `wrangler tail` is a websocket stream and does not
survive non-interactive capture in this environment (empty log, killed by timeout), so
error watching was done by probing the product surface instead of the log stream — a
weaker instrument for *silent* failures, adequate for availability and correctness.

## Cost of the proof

Three settled x402 calls, 0.03 USDC total (balance 1.221 → 1.191), all paid to the
operator's own `PAY_TO`. The paid route is genuinely payable end-to-end by a standard
`@x402/fetch` client with EIP-3009 on Base — no ETH needed in the buyer wallet for gas,
because the facilitator submits.

## Defect found: paid routes reject the demo aliases their manifest advertises

The 402 body resolves `token=USDC` to `0x833589…` in `resource.queryParams`, so an agent
negotiating payment is told the price for the *resolved* asset — then the retried request
carries the alias and the handler answers `400 token query param must be a 0x-prefixed
20-byte address`. No charge occurs (settlement is skipped on non-2xx), so this is a wasted
round-trip and a broken "check before you buy" funnel rather than a money-loss bug.

Consequence for this card: the acceptance URL in the ticket (`?token=USDC`) can never
return `"simStatus":"tested"`. Acceptance had to be evaluated with the canonical address.
Free/preview endpoints accept the aliases, which is why the mismatch was not caught
earlier.

Follow-up filed separately — do not fix inline here.

## Reproduce

```bash
# paid route, real address (pays 0.01 USDC)
node .scratch-x402/pay_token_report.cjs \
  "https://api.greyridgesignals.ai/chain/token-report?token=0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22"

# free fingerprint of the slot search
curl -s "https://api.greyridgesignals.ai/chain/token-security/preview?token=usdc"
```

The paying probe lives in `x402-data-api/.scratch-x402/` (gitignored) and reads the buyer
key from 1Password `op://Division/BUYER_WALLET_PK`, falling back to `buyer-wallet.json`.
