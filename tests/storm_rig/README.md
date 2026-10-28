# Storm rig — the failure mode `test_balance_slot_detection.mjs` cannot see

`tests/test_balance_slot_detection.mjs` asserts that the slot oracle is right. It cannot
assert that the *transfer probe survives a 429 storm*, because against idle public RPCs both
the hardened code and the naive code pass (measured: HEAD 20/20 on AERO and 40/40 on the
5-token burst while upstreams were healthy). A green real-RPC run is therefore not evidence
that burst hardening works.

This rig induces the production failure deterministically: N mock Base JSON-RPC providers that
answer everything normally **except** the transfer probe, which they 429 `STORM_K` times per
token report (counter resets on the first non-probe `eth_call` of a report). The mock serves a
canned slot-0 token, so discovery succeeds and only the probe is under storm — exactly the
"Balance slot located but the transfer-probe eth_call failed or was rate-limited" signature.

## Run

Point the Worker at the mocks (the endpoint list must contain the mock ports — the QA checkout
patches `BASE_RPCS` for this, it is not a production switch):

```bash
bash tests/storm_rig/start_mocks.sh 1          # 3 providers on :9111/:9112/:9113, 429 once each per report
BASE_URL=http://127.0.0.1:8788 RUNS=3 TOKENS=AERO \
  node tests/test_balance_slot_detection.mjs
```

## Expected

| STORM_K | meaning | naive (no retry) | hardened (`retries: 1` + storm gate) |
|---|---|---|---|
| 1 | every provider 429s once, then clears | `0/3` tested, slot located, provider-only | `3/3` tested, p50 ~375ms |
| 99 | storm never clears | `0/3`, `unavailable` | `0/3`, `unavailable` — fail-closed, truthful, ~335ms (no spin) |

`STORM_K=99` is a **pass** for the hardened code: a permanently rate-limited upstream must
degrade to `unavailable`, never to a fabricated `tested`.

Verified 2026-10-28 (t_ba0a27a7): naive 0/3 vs hardened 3/3 on the same storm; permanent storm
0/3 both, hardened bounded at 335ms.
