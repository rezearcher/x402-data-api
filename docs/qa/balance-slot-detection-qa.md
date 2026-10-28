# Balance-slot detection — QA report (card t_fc945e36)

Verification of the honeypot transfer probe after the balance-storage-slot candidate
expansion (`src/index.ts`, `CANDIDATE_SLOTS` 0..63 + the ERC-7201 `openzeppelin.storage.ERC20`
namespace, replacing the old 0..3 integer probe).

Harness: `tests/test_balance_slot_detection.mjs` — repeatable, three independent phases.

- **A — product surface.** `GET /chain/token-report/preview` ×8 per token, reading
  `security.simStatus`. Any non-`tested` run is immediately re-probed through
  `token-security/preview` so the failure is *named* rather than guessed:
  `provider` (transient RPC/load — proven by the re-probe succeeding),
  `detection-miss` (re-probe still cannot locate a slot), `metered` (HTTP 429 trial cap).
- **B — slot identity.** `GET /chain/token-security/preview` once per token; the reported
  `slot_layout` / `is_upgradeable` must equal the documented layout for that class.
- **C — independent oracle.** The Worker is taken out of the loop entirely: the expected
  slot is planted with `PROBE_VALUE` via `eth_call` `stateDiff` against three public Base
  RPCs and `balanceOf(PROBE_HOLDER)` must return exactly that value. This proves the
  *expected* slot is the real balance slot by cryptographic ground truth, so a match in B
  cannot be a coincidence of two wrong implementations.

Nothing in phase C trusts the code under test. Phase C is what makes a "tested" verdict
mean something.

## Results — local Worker (`wrangler dev --local`, port 8787), RUNS=8

64/64 core runs reported `tested`; 0 detection misses, 0 provider failures, 0 transport errors.

| token | class | tested | reported slot | oracle | upgradeable |
|---|---|---|---|---|---|
| USDC  | zOS upgradeable proxy      | 8/8 | `mapping@slot9`  | ✔ | true |
| cbBTC | zOS upgradeable proxy      | 8/8 | `mapping@slot9`  | ✔ | true |
| EURC  | zOS upgradeable proxy      | 8/8 | `mapping@slot9`  | ✔ | true |
| USDbC | EIP-1967 bridged proxy     | 8/8 | `mapping@slot51` | ✔ | true |
| cbETH | EIP-1967 bridged proxy     | 8/8 | `mapping@slot51` | ✔ | true |
| WETH  | native, non-proxied        | 8/8 | `mapping@slot3`  | ✔ | false |
| AERO  | non-proxied                | 8/8 | `mapping@slot0`  | ✔ | false |
| DEGEN | non-proxied                | 8/8 | `mapping@slot0`  | ✔ | false |

The three non-proxied tokens are the regression set the old 0..3 probe already covered
(slots 3, 0, 0) — all still resolve, so the expansion did not disturb them.

Earlier in the run, USDC was additionally taken to **20/20 tested** and production to
**8/8 tested**; both are unchanged by the later harness edits.

### Reported-slot spread actually exercised

slot 0 (AERO, DEGEN, TOSHI, BRETT, MOG, KEYCAT, USDT, DAI), slot 1 (wstETH),
slot 3 (WETH), slot 5 (VIRTUAL), slot 9 (USDC, cbBTC, EURC, cbXRP, cbLTC, cbDOGE),
slot 51 (USDbC, cbETH, tBTC). No token resolved through the ERC-7201 namespace, so that
leg of the candidate set remains unexercised by a real token — it is a fallback, not a
measured path.

## Edge-case sweep — 12 real Base ERC-20s outside the documented layouts

Every one resolved: wstETH → slot1, tBTC → slot51, cbXRP/cbLTC/cbDOGE → slot9,
TOSHI/BRETT/MOG/KEYCAT/USDT/DAI → slot0, VIRTUAL → slot5. **12/12 tested, no residual
`unavailable` among addresses that hold bytecode.**

## Fail-closed behaviour

| input | is_contract | sim_status | verdict |
|---|---|---|---|
| `0x1111…1111` (EOA) | false | `unavailable` | fail-closed ✔ |
| `0x60a3E35Cc302bFA44Cb288Bc5a4CC5F2FC9859f5` (no Base code) | false | `unavailable` | fail-closed ✔ |

A non-contract is never reported as a successful simulation.

## Two false alarms, and why they mattered

Both were misread as product defects for a few minutes. Both are now encoded as harness
behaviour so the next run cannot repeat the misdiagnosis.

1. **"EURC is a detection-miss."** The address under test was
   `0x60a3E35Cc302bFA44Cb288Bc5a4CC5F2FC9859f5`, which has **no bytecode on Base**
   (`eth_getCode` = `0x` on mainnet.base.org, publicnode, drpc) — an Ethereum-side
   address. The probe correctly failed closed; the test input was wrong. The genuine
   EURC is `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` (**differing tail**), and the
   product handles it at slot 9. The dead address is retained as a negative control and
   the real one is in the gated set; both are commented so the two are never swapped.
2. **"Repeated runs regress metered tokens to unavailable."** HTTP 429,
   `real_token_checks_left_today: 0` — the 3/day/IP free-trial cap. Its KV is persisted
   in the local wrangler state, so a fixed spoof range collided on the second run and
   looked exactly like flakiness. The harness now randomises a /16 per process and treats
   429 as `metered`, never as a detection result.

Related: sending `cf-connecting-ip` to a real deployment returns **403 (Cloudflare error
1000)**. The header is a local-dev-only device (no CF edge in front of `wrangler dev`);
production owns that header and rejects spoofing. The harness only spoofs against
`127.0.0.1`/`localhost`.

## Residual risk — provider load, not detection

Under burst (many token reports back-to-back on one Worker) non-USDC tokens intermittently
return `sim_status: unavailable`. Diagnosed, not assumed:

- The note is *"Balance slot located but the transfer-probe eth_call failed or was
  rate-limited on every RPC attempt"* — slot found, probe degraded.
- An immediate quiet re-probe of AERO returned 6/6 `tested`; a production burst gave
  AERO 3/8 then 6/6 quiet. Same code, different upstream pressure.
- One production sample showed `sim_status: unavailable` while the corroborating
  `token-security` call succeeded in the same second — that pair is what proved these are
  transients and drove the `provider` classification.

So: the detection path is correct and degrades honestly (fail-closed with a truthful
note). Burst reliability against the public Base RPCs is the weak link, not the slot
search. Worth its own card if throughput matters (retry/backoff across more RPCs, or a
paid endpoint); deliberately not folded into this verification.

## Coverage limits, stated plainly

- Only Base mainnet, only tokens whose `balanceOf` is a plain `mapping(address => uint256)`.
  Reflection/rebasing math, packed structs, and custom namespaces above slot 63 are
  documented as out of scope and would report `unavailable` — correctly, not silently.
- The probe proves a *plain transfer* does not revert. It is not a DEX round-trip: a token
  that blocks sells only via its LP pair can still return `transferable: true`. The note
  says so; do not read `tested` as "safe to buy".
- The ERC-7201 leg has no real-token evidence (see above).

## Reproduce

```bash
npx wrangler dev --port 8787 --local &
node tests/test_balance_slot_detection.mjs                    # full suite, RUNS=8
RUNS=20 TOKENS=USDC node tests/test_balance_slot_detection.mjs # flakiness probe
BASE_URL=https://api.greyridgesignals.ai TOKENS=USDC,cbBTC,WETH,AERO,DEGEN \
  RUNS=8 node tests/test_balance_slot_detection.mjs           # against a deployment
```

Env: `BASE_URL`, `RUNS`, `TOKENS` (csv filter; suppresses the sweep), `REQ_TIMEOUT_MS`.
Exits non-zero on any detection miss, transport error, slot mismatch, oracle mismatch, or
non-contract false positive. Warnings (quota exhaustion) do not fail the run — no evidence
is not the same as a defect.

Evidence logs: `~/.hermes/profiles/qa/cache/scratch/qa_slots/` (`ARTIFACT_local8.log`,
`prod8b.log`, `final_local*.log`, `prod_eurc.log`).
