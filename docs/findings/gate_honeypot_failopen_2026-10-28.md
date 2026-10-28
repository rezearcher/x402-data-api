# P0: /gate/swap returns GO on a confirmed honeypot (sellability-unverified is not a gate input)

**Date:** 2026-10-28
**Found by:** t_27d5d45e (deploy/verify card)
**Deployed commit under test:** `main` @ `21fd4bd` + `061c2f3` (worker `x402-data-api`)

## Verdict on the card's ACCEPTANCE

| half | expected | observed | pass |
|---|---|---|---|
| USDC buy | `go` | `go` | YES |
| honeypot buy | `block` | **`go`** at $100 notional (`hold` only at $1000) | **NO** |

The `block` branch still has never fired on real on-chain evidence, and this run shows it
is not merely an unvalidated branch — it is **reachable-but-skipped** on a confirmed honeypot.

## Evidence

### 1. A real, live, confirmed honeypot on Base

`0xb20000000000000000000078ee7ce2fe4908108c` ("NVDAc", pool **NVDAc / WETH 0.056%**)

honeypot.is (`api.honeypot.is/v2/IsHoneypot?address=…&chainID=8453`):

```json
{"isHoneypot": true, "honeypotReason": "execution reverted: STF",
 "buyTax": 0, "sellTax": 100, "simulationSuccess": true, "riskLevel": 100}
```

Second, independent token `0xb2000000000000000000002d0ba3164cc74f58b7` ("GOOGLc",
pool GOOGLc / WETH 0.07%, $46k liquidity) reports the same: `sellTax 100`, STF revert,
`isHoneypot: true`. Both were found by harvesting fresh Base pools from GeckoTerminal and
screening ~63 WETH-paired candidates — i.e. these are live, currently-funded pools, not
exhausted rugs. (Earlier candidates from public writeups — $BAR, and the USDC-paired
`0xb2000…` cluster with AMZNc/METAc/etc. — are either drained (`no_pool`) or lack a WETH
pool, which is why the benchmark file shows 0 positives: **a honeypot stops being testable
once its liquidity is pulled**, so a static benchmark of old addresses cannot hold positives.)

### 2. The gate says GO

`GET /gate/swap/preview?token=0xb200…108c&side=buy&notional=100`:

```json
{"decision": "go",
 "reason": "modest WETH-pool liquidity (~$24,842); slippage risk on size",
 "verdict": "CAUTION", "risk_score": 10, "liquidity_usd": 24842,
 "impact_pct_of_pool": 0.4,
 "flags": ["modest WETH-pool liquidity (~$24,842); slippage risk on size",
           "transfer simulation unavailable (non-standard storage layout); sellability unverified"]}
```

The same token at `notional=1000` returns `hold` — but only because 1000/24842 = **4.0% of
pool** trips the >2% size branch. The honeypot is invisible to the decision either way.
Any agent sizing correctly (small notional, as the gate itself advises) gets **GO**.

`transfer simulation unavailable … sellability unverified` is present in `flags` and yet the
decision is `go`: the gate is telling the caller it cannot verify the token is sellable and
then authorizing the buy.

## Root cause (exact)

`src/index.ts`:

- L8458 `deepLiquidity = liqUsd >= MIN_SAFE_LIQUIDITY_USD * 10` and `MIN_SAFE_LIQUIDITY_USD = 100_000` (L8224)
  → deepLiquidity requires **\$1,000,000**. NVDAc's \$24,842 is not deep.
- L8459 `sellabilityUnverified = !!sec && !simTested && !avoid` → **true** for this token.
- L8473 `risky = (sellabilityUnverified && !deepLiquidity) || …` → **true**.
- L8474 `verdict = … score >= 30 || risky ? "CAUTION"` → **CAUTION**, score 10.

So `buildTokenReport` has already concluded *CAUTION precisely because sellability is
unverified*. But `decideSwapGate` never receives that reason — it only sees
`verdict` and `risk_score`:

- branch 5: `if (s.verdict === "CAUTION") return { decision: s.side === "buy" && s.risk_score >= 50 ? "hold" : "go", … }`

`risk_score` is 10 < 50 → **go**. The `risky` flag that produced the CAUTION is discarded,
and its threshold (any flag) is stricter than the gate's re-derived threshold (50).

The gate fails closed on *unknown liquidity* (branch 3, "never GO") but has no equivalent
rule for *unknown sellability*. That asymmetry is the bug.

## Why it matters

The product's one-line promise is "is it a honeypot, can you sell it" — and the paying
customer is an autonomous agent that will act on `go` without reading `flags`. Returning
`go` on a sellTax-100 token is the single worst failure mode the endpoint exists to prevent,
and it is invisible to the free-preview caller.

## Suggested fix (owner: coder — do not patch in the verify card)

Make "sellability unverified" a first-class signal in `decideSwapGate`, symmetric with the
existing `noLiquidityEvidence` branch:

1. Add `sellability_unverified: boolean` to `SwapGateSignals`, populated from
   `buildTokenReport` (surface the existing L8459 boolean).
2. In `decideSwapGate`, before the CAUTION branch:
   `if (s.sellability_unverified) return { decision: s.side === "buy" ? "hold" : "hold", reason: "transfer simulation could not run — sellability unverified; refusing to auto-buy an exit-unconfirmed token" }`.
3. Keep `AVOID`/size branches above it so a proven honeypot still BLOCKs.
4. Add contract tests: honeypot-with-unrunnable-sim + deep-enough pool + small notional → **hold/block, never go**.

Note the deepLiquidity cap at L8469 (`score = Math.min(score, 25)`) also fires when
`!simTested`, so an unverified token can never reach the 50 threshold — the score path cannot
be fixed by tuning the threshold alone; the signal must be explicit.

## Reproduction

Worker was run locally (`npx wrangler dev --local`) because the production free-preview
trial (3 real tokens/IP/day) was already exhausted for this egress IP — production returned
HTTP 429 `real_token_checks_left_today: 0`. Local run exercises the **same src** against
**real Base RPC**; only KV (trial counter) is local. Production USDC `go` and canary `block`
were both reproduced against the deployed worker.
