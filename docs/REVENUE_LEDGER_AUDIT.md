# Revenue Ledger Audit — Self-Traffic Classification

**Audit date:** 2026-07-23
**Auditor:** `scripts/verify_revenue_ledger.py`
**Method:** On-chain forensic verification via Base mainnet public RPC (`eth_getTransactionReceipt`), reading each row's USDC Transfer event's **indexed `from` topic** — same technique as `check_paid_calls.sh`.

## Summary

| Metric | Value |
|---|---|
| Total ledger rows | 26 |
| Total reported USDC | \$0.400000 |
| Self-traffic USDC | \$0.385000 (23 rows) |
| Verified external USDC | \$0.015000 (3 rows) |
| Unresolved | \$0.000000 (0 rows) |
| **Contamination rate** | **96.25%** |
| **True external revenue** | **3.75%** of reported |

## Key Finding

**Only 3 of 26 ledger rows represent genuine external revenue.** The remaining 23 rows (96.25% by value) are self-traffic — USDC transfers from our own wallets to the PAY_TO address, indistinguishable from real API payments in the ledger alone.

## Self-Traffic Breakdown

- **18 rows** (`\$0.235`) — `from=0xc4852c26498d3187dec2ce1b19e840710e302d1e` — the `buyer-wallet.json` funder address
- **5 rows** (`\$0.150`) — `from=0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10` — PAY_TO to PAY_TO self-transfers

## Genuine External Revenue

All 3 external rows originate from payer `0x7e571e959cc7c75ccdd2eac24f8775ea2eaa2f09`, totaling exactly **\$0.015**:

| # | ref | Amount |
|---|---|---|
| 24 | `0x3e969e2dc30058ef7e...` | \$0.005 |
| 25 | `0x87b6fe126e996a1bb5...` | \$0.005 |
| 26 | `0x7412439d17119d2511...` | \$0.005 |

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

The gap.json currently reports `revenue_usd=0.4` from the ledger sum. The genuine external revenue is **$0.015** — meaning the gap to the first milestone target ($1.00) is **$0.985, not $0.60**. The contamination inflates apparent progress by 26×.

## Recommendation

Either:
1. Filter self-traffic from ledger recording (deduct `buyer-wallet` and PAY_TO transfers at recording time), or
2. Maintain a separate `revenue_external_usd` metric in the gap computation that uses the verified summary.
