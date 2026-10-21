# Grey Ridge x402 — proof pack for integrators

What a seller usually can't show you: the paid path actually settling on-chain and
delivering, plus honestly-measured reliability and accuracy. Everything below is
reproducible from this repo or verifiable on Base — no marketing numbers.

Last refreshed: 2026-10-21. Base API: `https://x402-data-api.sigrunner.workers.dev`

---

## 1. Paid-delivery proof — a real settled x402 call on Base mainnet

The whole point of x402 is that a 402 challenge, a signed payment, and a 200 with a
real result all happen in one call. Here is one end-to-end, verifiable on-chain.

**The unpaid request returns a priced 402 challenge** (network `eip155:8453` / Base,
asset USDC, 6 decimals, EIP-3009 gasless):

```
$ curl -i "https://x402-data-api.sigrunner.workers.dev/gate/swap?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631&side=buy&notional_usd=500"
HTTP/1.1 402 Payment Required
{ "x402Version": 2, "error": "Payment required",
  "accepts": [ { "scheme": "exact", "network": "eip155:8453", "maxAmountRequired": "8000",
                 "asset": "0x833589fcD6eDb6E08f4c7C32D4f71b54bdA02913" /* USDC on Base */ } ] }
```

**A settled call to the same route** (0.008–0.01 USDC depending on route) returns the
full verdict — the same shape as the free preview, but unmetered and for any Base token.

**On-chain proof the payment settled and the facilitator relayed it (not us):**

- Tx: https://basescan.org/tx/0x2821af0057408caf18c5034182ab63c5904e3dffbde0ecb89e92c76e860a7432
- Decoded (confirmed live via `eth_getTransactionReceipt` on Base mainnet, 2026-10-21):
  - **status `0x1`** (success), block **52863233**, 2026-10-20T17:03:33Z
  - payer `0xc4852c…` → **payTo `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`**, **0.01 USDC**
  - relayer (`from`) `0xb87e1a2cc2b4643f2892768e80e41167f17c5860` = **CDP facilitator** — the gasless
    EIP-3009 submitter, the exact same scheme Coinbase CDP / x402-fetch buyers already use
  - `to` = `0x833589fcD6eDb6E08f4c7C32D4f71b54bdA02913` = **USDC contract on Base**, 2 Transfer logs

> Honest label: this specific tx is an **operator test** (we paid our own endpoint once to
> capture a decoded receipt), *not* external revenue — we never count self-payments as sales.
> It is here to prove the paid mechanism settles and delivers end-to-end on Base mainnet.
> Your own paid call produces the same shape with your wallet as payer and your `&ref=` tag
> recorded on the settled tx (see reseller attribution below).

**Try the delivery for free first** — every flagship route has a no-wallet preview with the
same response shape:
`.../gate/swap/preview?token=aero` · `.../chain/token-report/preview?token=aero`

---

## 2. Reliability — measured, not an SLA

Live machine-readable JSON: `GET /status`. Human copy: [`docs/STATUS.md`](./STATUS.md).

- **99.86% success across 2,860 probes** (2026-10-19 → 2026-10-21, 5-min cadence, 6 flagship
  free/preview paths). Source artifact: [`data/uptime_samples.jsonl`](../data/uptime_samples.jsonl),
  producer [`scripts/uptime_probe.py`](../scripts/uptime_probe.py).

| endpoint | samples | success | p50 ms | p95 ms |
|---|---|---|---|---|
| /chain/gas-price/preview | 531 | 100.0% | 360 | 1573 |
| /chain/token-report/preview | 531 | 99.8% | 2221 | 3532 |
| /chain/token-security/preview | 531 | 99.8% | 1426 | 3032 |
| /crypto/prices/preview | 531 | 100.0% | 397 | 1175 |
| /gate/swap/preview | 531 | 99.6% | 2421 | 3730 |
| /scan/mcp/preview | 151 | 100.0% | 191 | 1057 |

Short window — treat as a running measurement, not a contractual SLA.

---

## 3. Accuracy — what we measured, stated honestly

We cross-checked our token-safety verdicts against GoPlus on **355 Base tokens** across
three benchmark sets — artifacts in repo:
[`benchmark_token_report.json`](../data/benchmark_token_report.json) (n=30),
[`benchmark_honeypots.json`](../data/benchmark_honeypots.json) (n=137),
[`benchmark_risky.json`](../data/benchmark_risky.json) (n=188), via
[`scripts/benchmark_*.py`](../scripts/).

- **0 false-AVOID flags**: on every token GoPlus cleared, we also cleared it (100% agreement
  on the token-report set). Our live honeypot *sell-simulation* ran (`simStatus: tested`) on
  the honeypot set rather than trusting a static flag.
- **Honest caveat — this bounds false-positive rate, not recall.** These sets are
  negative-heavy (GoPlus flagged 0 as malicious), so they show we don't cry wolf on safe
  tokens; they do **not** yet prove detection recall against a labeled set of known-malicious
  Base tokens. We don't publish a recall number because we haven't benchmarked one. If
  threat recall matters for your flow, tell us and we'll build that benchmark against your
  token set before you commit to a paid tier.

What is genuinely differentiated vs. raw honeypot-flag APIs: `/gate/swap` returns **one
decision (GO/HOLD/BLOCK) sized to your trade** (notional_usd vs Uniswap v3 pool liquidity
price-impact) plus a reason — not a flag your agent has to interpret.

---

## 4. Attribution for resellers / referral partners

Append `&ref=<your-tag>` to any call URL. The tag rides through the 402→sign→retry and is
recorded on the settled on-chain call, so your referred volume is measurable and attributable
(distinct buyers + Base txHashes). Ask contact@greyridgesignals.ai for a reconcile report on
your tag.

Questions / a benchmark against your token set: contact@greyridgesignals.ai
