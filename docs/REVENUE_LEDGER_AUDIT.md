# Revenue Ledger Audit — Self-Traffic Classification

**Audit date:** 2026-07-23 (re-verified 2026-08-02)
**Auditor:** `scripts/verify_revenue_ledger.py`
**Method:** On-chain forensic verification via Base mainnet public RPC (`eth_getTransactionReceipt`), reading each row's USDC Transfer event's **indexed `from` topic** — same technique as `check_paid_calls.sh`.

## Summary

| Metric | Value |
|---|---|
| Total ledger rows | 28 |
| Total reported USDC | \$0.410000 |
| Self-traffic USDC | \$0.385000 (23 rows) |
| Verified external USDC | \$0.025000 (5 rows) |
| Unresolved | \$0.000000 (0 rows) |
| **Contamination rate** | **93.9%** |
| **True external revenue** | **6.1%** of reported |

## Key Finding

**Only 5 of 28 ledger rows are external — and 4 of them trace to a probe/farming bot.** The remaining 23 rows (93.9% by value) are self-traffic — USDC transfers from our own wallets to the PAY_TO address, indistinguishable from real API payments in the ledger alone. After the probe check, only 1 row ($0.005) is not bot-flagged.

## Self-Traffic Breakdown

- **20 rows** (`\$0.235`) — `from=0xc4852c26498d3187dec2ce1b19e840710e302d1e` — the `buyer-wallet.json` funder address
- **3 rows** (`\$0.150`) — `from=0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10` — PAY_TO to PAY_TO self-transfers

## External Revenue (non-self-traffic)

All 5 external rows come from two payers — 4 from `0x7e571e959cc7c75ccdd2eac24f8775ea2eaa2f09` totaling **\$0.020** (probe/farming bot — see addendum) and 1 from `0x7e81988b7187eb3c3a65229bb1536fa1039234a7` totaling **\$0.005** (probe score 0.200 — likely genuine):

| # | ref | Amount | Payer |
|---|---|---|---|
| 24 | `0x3e969e2dc30058ef7e...` | \$0.005 | `0x7e571e...` |
| 25 | `0x87b6fe126e996a1bb5...` | \$0.005 | `0x7e571e...` |
| 26 | `0x7412439d17119d2511...` | \$0.005 | `0x7e571e...` |
| 27 | `0x4aa313ca4df0859ed7...` | \$0.005 | `0x7e571e...` |
| 28 | `0x82cb9a6b66d300d2ad...` | \$0.005 | `0x7e8198...` |

## Method

Each row's `ref` (transaction hash) was fed to `eth_getTransactionReceipt` on `https://mainnet.base.org`. The response's logs were scanned for a USDC Transfer event (`0xddf252ad...`), and the **indexed `from` address** was extracted from `topics[1]`. This `from` address was checked against known self-traffic addresses:

- `0xc4852c26498d3187dec2ce1b19e840710e302d1e`
- `0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10`

> **Why `tx.from` cannot be used:** In x402's gasless EIP-3009 flow, `tx.from` is the relayer/facilitator, not the payer. Only the USDC Transfer event's indexed `from` topic reflects who actually paid. This is the same distinction documented in `check_paid_calls.sh`.

## Tool

The verification script lives at `scripts/verify_revenue_ledger.py` and produces `~/.hermes/data/x402-data-api-revenue/ledger_verified_summary.json`.

To re-run:
```bash
python3 scripts/verify_revenue_ledger.py
```

## Gap Impact

The gap metric (`.metrics/revenue_usd`, produced by `.metrics/compute_revenue_usd.py`) reads `revenue_usd=0.005` (regenerated 2026-08-02 from the re-run sidecars: 5 external rows, 4 probe-flagged deducted, 1 organic remaining). The likely-genuine external revenue is **$0.005** — meaning the gap to the first milestone target ($1.00) is **$0.995, not $0.60**. The uncorrected ledger sum ($0.41) inflates apparent progress by 82×.

## Recommendation

Either:
1. Filter self-traffic from ledger recording (deduct `buyer-wallet` and PAY_TO transfers at recording time), or
2. Maintain a separate `revenue_external_usd` metric in the gap computation that uses the verified summary.

---

## Addendum: Probe-Likelihood Analysis of External Payer

**Analysis date:** 2026-07-24  
**Method:** On-chain behavioral analysis via `--probe-check` flag in `scripts/verify_revenue_ledger.py`, querying Blockscout API (`base.blockscout.com`) for transaction history, method calls, and token transfers of the external payer address.

### Motivation

The original audit found only 1 external payer across the then-26 ledger rows:
`0x7e571e959cc7c75ccdd2eac24f8775ea2eaa2f09` (3 payments, $0.015 total). The verifier
re-run on 2026-08-02 (28 rows — see Summary) found 2 external payers: `0x7e571e...`
(4 payments, $0.020) and `0x7e81988b7187eb3c3a65229bb1536fa1039234a7` (1 payment, $0.005).
The earlier larger-window row count referenced in this addendum's original footnote is superseded
by the 28-row verifier output; this document is reconciled to that output.

To determine whether this payer represents a real human user or an automated bot/probe, we ran on-chain behavioral triage using three independent heuristics.

### Results

| Heuristic | Value | Score Contribution |
|-----------|-------|-------------------|
| H1: Nonce (total tx count) | 3,176 | +0.40 |
| H2: Repeated method burst | 15× `giveFeedback` → `0x061959...b6e` in 120s | +0.35 |
| H3: Unsolicited farm tokens | 5 tokens (PDBTC, XST, USD̲C, USDC, HRI) | +0.25 |
| **Composite Probe Score** | **1.000** | **PROBE / FARMING BOT** |

### Heuristic Details

**H1 — Nonce (3,176):** The address has sent 3,176 transactions on Base since its first activity. This is ≈15.6 transactions/day average — far above any normal human usage pattern. Addresses with nonce ≥ 1,000 receive +0.4.

**H2 — Method burst (15× `giveFeedback` in 120s):** The address repeatedly calls `giveFeedback(bytes32,string)` on contract `0x061959e70fb718d7891027283afbfe2875696b6e` — a gamified feedback/reputation dApp commonly used by bot farms. We detected 15 identical calls to the same contract + method within a 120-second window (1 call per 8 seconds). This is an unambiguous automation signature. Method burst ≥ 5 within any 120s window receives +0.35.

**H3 — Farm tokens (5 unsolicited receipts):** The address has received transfers of PDBTC, XST, USD̲C, USDC, and HRI tokens from external senders it has never transacted with. These are "dusting" / airdrop patterns typical of farm-token distribution to bot addresses. Each unique unsolicited sender contributes +0.1 (capped at +0.25).

### Revised Impact Assessment

With the probe analysis confirming 4 of the 5 external payments trace to a farming bot, **the x402 data API had effectively zero human users** during the audit period. The only non-bot-flagged payment ($0.005 from `0x7e8198...`, probe score 0.200) may be a stray human — or a second, subtler automated payer. The true organic revenue is **$0.005**.

| Revenue Source | Amount | Nature |
|----------------|--------|--------|
| Self-traffic (own wallets) | $0.385 | Contamination |
| Bot payer (`0x7e571e...`) | $0.020 | Automated probe (4 payments) |
| Unflagged payer (`0x7e8198...`) | $0.005 | Probe score 0.200 — likely genuine |
| **Organic human usage** | **$0.005** | **1 payment, not bot-flagged** |

**Verdict:** `probe_likely: true` for `0x7e571e...` (farming bot); `probe_likely: false` for `0x7e8198...` (score 0.200) — see `probe_check_summary.json`.

### Prerequisites

The probe check requires:
- Internet access to `https://base.blockscout.com` (Blockscout API)
- No API key or authentication needed (public endpoint)

To re-run:
```bash
python3 scripts/verify_revenue_ledger.py --probe-check
```

---

## Provenance note (SRE rescue, 2026-07-24)

This document was originally authored on branch `wt/t_efa5b713` (commits `b2089a2`, `5bd500f`)
as part of card `t_efa5b713` but was never merged to `main` — an SRE maintenance pass found it
stranded and rescued it. In the interim, cards `t_5c08554f` and `t_913952c8` independently
reconfirmed the same finding (probe-likelihood addendum, `probe_likely: true`, $0.00 organic
revenue) and landed a smaller duplicate version of this file in `main`; this rescue restores
the fuller original audit and folds the duplicate content back into one canonical document.
