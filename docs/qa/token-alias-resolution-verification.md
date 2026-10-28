# Paid x402 routes now resolve the demo token aliases their own manifest advertises

Card: `t_53e0754d` · Repo: `x402-data-api` · Commit: `45ba4d0` (main) · Verified live 2026-10-28 ~07:2x–07:3xZ

## The defect

The 402 body for `GET /chain/token-report?token=USDC` advertised the **canonical**
contract address in its own negotiation payload, then the paid handler rejected the
retried request:

```
resource.url                                        = .../chain/token-report?token=USDC
extensions.bazaar.info.input.queryParams.token       = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
-> retry with payment -> 400 {"error":"token query param must be a 0x-prefixed 20-byte address"}
```

Settlement is skipped on a non-2xx response, so nothing was charged — but an agent
that negotiated payment *by reading the manifest* could never receive the product.
The demo / first-dollar funnel was unpassable for any caller using the alias form.

Cause: the alias table existed only next to the **free preview** routes
(`PREVIEW_DEMO_TOKENS`). The bazaar input sample rendered canonical addresses while
the paid handlers validated with a bare `ADDR_RE` test.

## The fix — one table, one resolver, no drift

`src/index.ts`:

* `DEMO_TOKEN_ALIASES` (+ `DEMO_TOKEN_ALIAS_HINT`) moved next to `ADDR_RE`, making it
  the single source of truth for `usdc | weth | cbbtc | cbeth | aero | degen`.
* `resolveTokenQuery(raw)` maps a valid 20-byte address through untouched, maps a
  known alias (case-insensitive, trimmed) to its canonical address, and fails closed
  on anything else.
* `PREVIEW_DEMO_TOKENS` is now the *same object*, not a copy. All three layers read
  it: free previews, paid handlers, discovery surfaces.
* Paid routes switched to the resolver: `/chain/token-report`, `/chain/token-security`,
  `/gate/swap`, `/gate/swap/unlock`, `/chain/token-balance`, `/chain/erc20-meta`,
  `/chain/total-supply`, `/chain/allowance`.
* The bazaar `input.queryParams.token` samples that build the 402 body are now rendered
  from `DEMO_TOKEN_ALIASES.usdc` (was a second hard-coded literal), and
  `/.well-known/x402` publishes `demo_token_aliases` from that same table.
* Added `cbeth` (`0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22`) — verified on Base by
  `eth_call symbol()/decimals()` = `cbETH` / 18. All six aliases were re-verified the
  same way: USDC/6, WETH/18, cbBTC/8, cbETH/18, AERO/18, DEGEN/18.

Guardrails held: unknown symbols still 400 and never settle; price/network/settlement
untouched (`0.01` USDC = `10000` units on `eip155:8453`); deploy went through
`.github/workflows/deploy.yml` on a clean push, never a manual `wrangler deploy`.

## Live evidence (production)

Deploy observed at `07:23:21Z` — `/.well-known/x402` began serving the
`demo_token_aliases` block (`null` at 07:23:06Z, present at 07:23:21Z).

| probe | result |
|---|---|
| unpaid `GET ?token=USDC` | 402, `x402Version: 2`, `resource.url` keeps `?token=USDC`, advertised `queryParams.token` = `0x8335…2913`, amount `10000` |
| unpaid `GET ?token=notatoken` | 402 (middleware gate before the handler) |
| **paying client** `?token=notatoken` | **400**, `payment-response` header **absent**, error lists `usdc|weth|cbbtc|cbeth|aero|degen` → fail-closed, **uncharged** |
| **paying client** `?token=USDC` | **200**, body `token` = `0x8335…2913`, `security.simStatus` = `tested`, `verdict` SAFE, `payment-response` present |
| **paying client** `?token=weth` | **200**, body `token` = `0x4200…0006`, `security.simStatus` = `tested`, `verdict` SAFE, `payment-response` present |
| control: canonical address | 200 + settled (`tx 0xfc9d79dd…`) |

Settlements (buyer → payTo, 0.01 USDC each): `0xfc9d79dd3b52cf191a59c6047c11d45efc57dfab293e18968e6885b098faae2a`,
`0x571d6ec8ed0880ced16548b9731b6796a94f507dffa39c57a40d727320809b87`, plus two more
from the `?token=weth` / repeat `?token=USDC` probes. Buyer USDC balance 1.162 → 1.122 =
**0.04 = exactly 4 settles**, which independently confirms the one failed attempt was
not charged.

Acceptance CHECK (verbatim):
`curl -s 'https://api.greyridgesignals.ai/chain/token-report?token=USDC' | grep -q '"payment required"\|"x402Version"' && node tests/test_alias_resolution.mjs`
→ 402 body matches, `PASS — 15 alias-resolution contract checks`.

## Observation (pre-existing, not introduced here)

The first `?token=USDC` paid attempt failed **before settlement** with
`Too many subrequests by single Worker invocation` (facilitator settle error in the
`payment-response` header, `success:false`, uncharged). The canonical-address control
run immediately after succeeded (200 + settle), and a repeat alias run then succeeded
too — so this is the known cold-cache RPC fan-out hitting the per-invocation subrequest
cap, not an alias-path defect. Worth its own card: a paid invocation that burns the
subrequest budget returns an opaque 402 with an empty body, which reads to a buyer-agent
as "still unpaid" rather than "we failed, retry". No money moved, so it is a funnel/
observability issue rather than a billing one.

## Tests

`tests/test_alias_resolution.mjs` (new, 15 checks) — imports the real Worker module
through the `cfw-hooks` loader and asserts:

1. `?token=USDC` / `weth` / `cbETH` (all case variants) resolve to the canonical
   addresses the manifest advertises;
2. raw addresses pass through byte-for-byte (case preserved, no checksum rewriting)
   and alias ≡ address for every table entry;
3. `notatoken`, `cbeth2`, `usd`, `0x123`, empty/absent values fail closed;
4. **manifest-vs-handler parity**: for all seven paid token-taking routes, the
   `extensions.bazaar.info.input.queryParams.token` value in the real route config is
   accepted by that same resolver, round-trips unchanged, and equals
   `DEMO_TOKEN_ALIASES.usdc` — so a future edit to one side fails this test instead of
   silently re-breaking the funnel.

Also green: `test_notional_alias.mjs`, `test_sized_verdict.mjs`,
`test_gate_decision_contract.mjs`, `test_preview_gate_args.mjs`, `test_verify.mjs`,
`npx tsc --noEmit`. (`test_balance_slot_detection.mjs` needs a local `wrangler dev` on
127.0.0.1:8787 and was not run — unrelated to this change.)
