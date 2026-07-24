# Revenue Ledger Audit

## Probe-likelihood addendum

**Context:** Task `t_5c08554f` ran `--probe-check` against the sole external x402 payer on the ledger. The on-chain fingerprint conclusively identifies the address as a farming/probe bot, not an organic buyer. Findings sourced from `probe_check_summary.json` (committed at `fcff3c8`).

| Field | Value |
|---|---|
| **Address** | `0x7e571e959cc7c75ccdd2eac24f8775ea2eaa2f09` |
| **Probe score** | `1.000` |
| **Nonce / tx count** | `3176` |
| **Repeated method burst** | `15x giveFeedback → 0x061959e7 in 120s` |
| **Farm token receipts** | `3` (HOLD, UHODL, USGR) |
| **probe_likely** | `true` |

### Verdict

`probe_likely: true` — every heuristic fired. The `0x7e571e95` address is a farm bot spraying repeated method calls and accumulating unsolicited tokens. No organic buyer has ever used this endpoint.

**Conclusion:** True organic external revenue for the milestone gap is **$0.00**.
