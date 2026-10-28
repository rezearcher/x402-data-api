# Balance Storage Slot Detection — Ground Truth

**Status:** Empirically verified against live Base mainnet, 2026-10-28
**Type:** Research (read-only probing; no transactions signed or broadcast)
**Scope:** How to locate the `balanceOf` storage slot of an arbitrary ERC-20, and what that costs
**Implementation:** `src/index.ts` — `simulateTransferProbe()` (L7755), `CANDIDATE_SLOTS` (L7632), `mappingSlotKey()` (L7639)

---

## Executive summary

1. **There is no universal balance slot.** Measured on six major Base tokens: `0`, `3`, `9`, `51` — four distinct values. Any fixed-slot assumption is wrong for most tokens.
2. **The card's premise is stale.** It described the simulator as probing "slots 0-3". The shipped code already scans **0–63 plus the OpenZeppelin ERC-7201 namespace** (65 candidates). This document supplies the evidence behind that choice and the numbers to defend or revise it.
3. **0–20 is not enough; 0–63 + ERC-7201 is.** A 0–20 window still misses 2 of 6 tested tokens (the slot-51 family: bridged USDbC, cbETH). Measured coverage: 0–3 → 2/6, 0–10 → 4/6, 0–20 → 4/6, 0–63 → 6/6. See the coverage matrix.
4. **A known-slot map is not required.** A single batched `stateDiff` override covering all 65 candidates, followed by binary narrowing, resolves the slot in **7–8 `eth_call` subrequests** — with no per-token hardcoded table. A hardcoded map would be a latency optimization, not a correctness requirement, and it decays as tokens change.
5. **Proxy detection and slot discovery are independent problems.** Proxy slots tell you *upgradeability risk*; they are not an input to finding `balanceOf`'s slot. Storage always lives in the proxy's own storage, so discovery runs against the token address directly. Coupling them (as the original framing did) is a category error — but both are still worth reporting, for different reasons.
6. **Cost is subrequests and latency, not gas.** Detection uses `eth_call` with `stateDiff` overrides: nothing is signed, nothing is broadcast, no gas is spent.

---

## Guardrail answers (explicit)

| Guardrail question | Answer | Evidence |
|---|---|---|
| Implementation slot read pattern for ERC-1967 | `eth_getStorageAt(token, IMPLEMENTATION_SLOT, "latest")`; non-zero ⇒ proxy, low 20 bytes = implementation address | Below, with all six constants re-derived from `keccak256` |
| Known balance slots for USDC, WETH, others | USDC **9**, WETH **3**, USDbC **51**, cbBTC **9**, cbETH **51**, AERO **0** | Verified two ways: raw `eth_getStorageAt` for a real holder, and override-then-`balanceOf` |
| Wider scan (0–10 / 0–20) feasible, or is a known-slot map required? | **Wider scan feasible; map not required.** But 0–10 and 0–20 are both **insufficient** (4/6). Use **0–63 + ERC-7201**. | Coverage matrix below |
| Constraints (gas, false positives, compatibility) | No gas (read-only). 7–9 subrequests of the Workers budget. False-positive/negative classes enumerated below. | Cost + limitations sections |

---

## 1. Proxy slot constants — re-derived, not copied

Derived from the EIPs (`keccak256(name) − 1` for EIP-1967; no offset for EIP-1822's `PROXIABLE`; no offset for zOS legacy) and matched byte-for-byte against the constants in `src/index.ts`.

| Slot | Derivation | Value |
|---|---|---|
| **IMPLEMENTATION_SLOT** | `keccak256("eip1967.proxy.implementation") - 1` | `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` |
| **ADMIN_SLOT** | `keccak256("eip1967.proxy.admin") - 1` | `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103` |
| **BEACON_SLOT** | `keccak256("eip1967.proxy.beacon") - 1` | `0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50` |
| **PROXIABLE** (EIP-1822/UUPS) | `keccak256("PROXIABLE")` — **no `-1`** | `0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7` |
| **zOS implementation** (legacy) | `keccak256("org.zeppelinos.proxy.implementation")` | `0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3` |
| **zOS admin** (legacy) | `keccak256("org.zeppelinos.proxy.admin")` | `0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b` |

All six verified `MATCH` against on-chain behaviour: USDC and cbBTC are **legacy zOS proxies** (their EIP-1967 slots are empty, their zOS slots are populated), while USDbC and cbETH are **EIP-1967** proxies. A detector that only reads the four EIP-1967/EIP-1822 slots would classify USDC as *not* a proxy — a correctness bug that only shows up if you check zOS slots too (which the shipped code does).

### ⚠️ Card guardrail constant is corrupt — do not copy it

The card quoted `IMPLEMENTATION_SLOT` as:

```
0x360894a13ba1a3210667c828492db98dca3e2f703339536ded9496f36c8467f3   ← WRONG
```

Canonical, derived and verified:

```
0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc   ← CORRECT
```

Same length (64 hex chars), mutated middle bytes — a silent-wrong-answer failure mode, not a visible syntax error. Any code using the card's value reads an empty slot and concludes "no proxy" for **every** token, including real proxies. **Always derive these constants; never copy a hash from prose, comments, or a ticket.**

---

## 2. Proxy ≠ slot: the conceptual correction

The original framing was "detect the proxy, then find the balance slot". That implies the implementation address is an input to slot discovery. It is not.

- A proxy **delegates** calls but every `SSTORE` lands in the **proxy's** storage. The implementation's source defines the *layout*, but the *data* is at the proxy address.
- Therefore slot discovery is performed against the token address directly, and it works identically for proxied and non-proxied tokens. Our probes never read the implementation address to find the slot.
- Consequence for the product: `upgradeableProxy` (risk signal: the owner can rewrite logic, e.g. add a transfer block later) and `balanceSlotIndex` (mechanism: how the sim injects a balance) are **two independent fields**. Do not let a proxy-detection failure suppress the honeypot sim, or vice versa.

The one place the implementation *does* matter: two tokens can share a slot number for unrelated reasons, so a slot number alone is not evidence of shared lineage. Slot 9 on USDC and slot 9 on cbBTC are both Coinbase zOS-proxy tokens (plausible shared base contract); slot 51 on USDbC and cbETH is the bridged/upgradeable pattern. These are correlations, not rules — treat them as hints only.

---

## 3. Measured balance slots (Base mainnet, 2026-10-28)

Method (two independent confirmations, per token):
1. **Raw state:** pick a real holder from recent `Transfer` logs, then check which candidate satisfies `eth_getStorageAt(token, keccak256(pad32(holder) ++ pad32(slot))) == balanceOf(holder)`.
2. **Behavioural:** override that slot for a synthetic holder and confirm `balanceOf(0x1111…1111)` returns exactly the injected value — then confirm a `transfer()` from that holder does not revert.

| Token | Address | Balance slot | Proxy type | Implementation (if proxied) |
|---|---|---|---|---|
| **USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | **9** | zOS (legacy) | `0x2ce6311ddae708829bc0784c967b7d77d19fd779` (admin `0x4fc7850364958d97b4d3f5a08f79db2493f8ca44`) |
| **WETH** | `0x4200000000000000000000000000000000000006` | **3** | none (OP Stack predeploy) | — |
| **USDbC** | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` | **51** | EIP-1967 | `0x1833c6171e0a3389b156eaedb301cffbf328b463` (admin `0xd94e416cf2c7167608b2515b7e4102b41efff94f`) |
| **cbBTC** | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | **9** | zOS (legacy) | `0x7458bfdc30034eb860b265e6068121d18fa5aa72` (admin `0x42d90b3faf2287475cdc863706bd7cc3e938c2af`) |
| **cbETH** | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | **51** | EIP-1967 | `0x07a71b9b835c9eba242836704d17da0953324e1f` (admin `0xd94e416cf2c7167608b2515b7e4102b41efff94f`) |
| **AERO** | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | **0** | none | — (Aerodrome governance token, not an LP token) |

WETH on Base is the OP Stack predeploy at `0x4200…0006` — no proxy, and its slot 3 comes from `mapping(address => uint) public balanceOf` being the fourth state variable. USDbC and cbETH sharing slot 51 reflects the upgradeable/bridged layout family, not a shared contract.

**Takeaway:** four distinct slots across six blue-chip tokens. Slot 9 alone (the most commonly cited "USDC slot") would miss half this set.

---

## 4. ERC-7201 namespaced storage (OpenZeppelin ≥ v5)

```
id      = "openzeppelin.storage.ERC20"
SLOT    = uint256(keccak256(abi.encode(uint256(keccak256(id)) - 1))) & ~bytes32(uint256(0xff))
        = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00
```

The `_balances` mapping is the first field of that struct, so a holder's word is:

```
word = keccak256(abi.encode(holder, SLOT))        // pad32(holder) ++ pad32(SLOT), then keccak
```

Correct JavaScript/TypeScript (matches `erc7201BaseSlot()` at L7625 and `mappingSlotKey()` at L7639):

```javascript
const inner = BigInt(keccak256(stringToHex("openzeppelin.storage.ERC20"))) - 1n;
const mask  = ((1n << 256n) - 1n) ^ 0xffn;   // clears only the low byte
const SLOT  = BigInt(keccak256(toHex(inner, { size: 32 }))) & mask;

// holder word — note: keccak of the CONCATENATION, never SLOT + keccak(...)
const holderWord = keccak256("0x" + holder.slice(2).toLowerCase().padStart(64, "0")
                                 + SLOT.toString(16).padStart(64, "0"));
```

Two traps worth calling out, because both produce silently wrong words:

- **Operator precedence.** `a & ((1n << 256n) - 1n) ^ 0xffn` parses as `(a & mask) ^ 0xff` in JS — it *flips* the low byte instead of clearing it. Keep the mask as `^ 0xffn` applied to the mask itself, or use `& ~0xffn` after converting to a BigInt (BigInt `~` is fine, unlike Number `~`).
- **`SLOT + keccak256(holder)` is not the mapping word.** Solidity mappings are `keccak256(pad32(key) ++ pad32(slot))` — hashing the concatenation, with no arithmetic on the base slot.

No token in this sample required the 7201 candidate (none is OZ-v5-`ERC20Upgradeable` with namespaced balances), so that path is **wired and costed but not yet proven against a live OZ-v5 token.** Flagged as an open verification item rather than claimed as validated.

---

## 5. Window coverage — is a wider scan worth it?

Measured by running the real batched-override + binary-narrowing discovery against each window. `MISS` = that window cannot find the slot.

| Token | 0–3 (card premise) | 0–10 | 0–20 | 0–63 | 0–63 + ERC-7201 |
|---|---|---|---|---|---|
| USDC | MISS (1 call) | slot 9 (4) | slot 9 (5) | slot 9 (7) | slot 9 (7) |
| WETH | slot 3 (3) | slot 3 (5) | slot 3 (6) | slot 3 (7) | slot 3 (7) |
| USDbC | MISS (1) | MISS (1) | **MISS (1)** | slot 51 (7) | slot 51 (7) |
| cbBTC | MISS (1) | slot 9 (4) | slot 9 (5) | slot 9 (7) | slot 9 (7) |
| cbETH | MISS (1) | MISS (1) | **MISS (1)** | slot 51 (8) | slot 51 (8) |
| AERO | slot 0 (3) | slot 0 (5) | slot 0 (6) | slot 0 (7) | slot 0 (8) |
| **coverage** | **2/6 (33%)** | 4/6 (67%) | **4/6 (67%)** | **6/6 (100%)** | 6/6 (100%) |

Conclusions:

- **The original 0–3 window explains the reported false "unavailable"** on exactly the tokens a token-safety product is asked about most: USDC, cbBTC, USDbC, cbETH. It got WETH and AERO right, which is why the bug looked intermittent rather than total.
- **0–10 and 0–20 are both insufficient** — they differ only in cost, not coverage, because the 51-family sits outside both. Going to 0–20 buys nothing over 0–10. So the answer to "0–10 or 0–20?" is: neither; the window has to reach past 51.
- **0–63 costs ~3–4 more subrequests than 0–10** (7 vs 4 on average) and takes coverage to 100% of the sample. That is the correct trade.
- **ERC-7201 costs at most +1 subrequest** (one extra candidate lengthens the final narrowing step) and is the only way to reach OZ-v5 namespaced balances. Keep it.

---

## 6. Detection algorithm (as shipped)

```
1. read token code            eth_getCode ≠ 0x            (1 call; no code ⇒ unavailable)
2. proxy classification       eth_getStorageAt × 5        (EIP-1967 impl/admin/beacon,
                                                           EIP-1822 PROXIABLE, zOS impl/admin)
                                                           → risk signal only, NOT a slot input
3. batched candidate probe    eth_call balanceOf(PROBE_HOLDER) with a stateDiff
                              pre-loading PROBE_VALUE under ALL 65 candidate slots  (1 call)
                              → result ≠ PROBE_VALUE ⇒ no candidate matches ⇒ unavailable
4. binary narrowing           halve the surviving set, re-probe               (6–7 calls)
5. transfer probe             eth_call transfer(PROBE_HOLDER → RECIPIENT, ½ PROBE_VALUE)
                              under the winning slot override               (1 call)
6. optional tax measurement   eth_simulateV1: balanceOf(R), transfer(H→R,X), balanceOf(R)
                              in one simulated block                         (1 call)
7. pair-targeted tax          same, but H/R substituted with the deepest
                              Uniswap-v3 WETH pool                          (≤2 calls)
```

`PROBE_HOLDER = 0x1111…1111`, `PROBE_RECIPIENT = 0x2222…2222`, `PROBE_VALUE = 31337e18`. A deliberately absurd balance makes accidental matches essentially impossible: the read must return *exactly* that value, and only the real `_balances` mapping can produce it.

**Call accounting.** Discovery + transfer = **7–9** subrequests (measured 8–9 end-to-end including the transfer probe; 7–8 for discovery alone). Failure is *cheaper* than success: if the batched probe finds nothing — no code, non-mapping `balanceOf`, dead providers — it returns after **1** subrequest. Worst case is bounded and small; there is no unbounded scan loop.

### Why binary narrowing is safe here

The batched probe proves a match exists in the candidate set. Halving it repeatedly converges on the match provided the mapping has a single home in the window. Two slots aliasing the same `balanceOf` value would pick the lower half — for a `mapping(address => uint256)` that cannot happen, since `balanceOf` reads one computed word. The cost of the whole scan stays `1 + ⌈log2(65)⌉ = 8` regardless of which slot wins, so a high slot number (like 51) is not slower than slot 0 — confirmed by the measured 7–8.

---

## 7. Constraints

**Gas: none.** Every step is a read-only `eth_call` / `eth_getStorageAt` / `eth_simulateV1` with `stateDiff` overrides. Nothing is signed, nothing is broadcast, no account needs funding, no gas is paid. "Gas cost" is the wrong axis for this feature; the real budgets are subrequest count, wall-clock latency, and provider reliability.

**Subrequests: 7–9 for the sim**, out of the Cloudflare Workers per-request limit (50 on the paid plan). With proxy classification, metadata, owner/mint/pause probes and liquidity reads, the full `/chain/token-report` path stays comfortably inside the cap — but the budget is worth tracking, since it is the constraint that would bite first if more per-token RPC work is added.

**Latency: 1.3–2.0 s** end-to-end, measured over three consecutive preview calls (2.03 s / 1.27 s / 1.60 s).

**False positives (sim says blocked when the token is fine).**
- *Permissioned / KYC tokens* — a token that whitelists holders will revert `transfer()` from `0x1111…1111`, and the sim reports `transferable:false`. That is indistinguishable from a honeypot at the transfer level. Not observed in the six tested tokens (USDC's blacklist is address-specific, so a plain wallet-to-wallet transfer passes), but it is the main structural false-positive class and deserves a note in the API output rather than a silent verdict.
- *Paused tokens* — a `Pausable` token reverts transfers while paused; transient, not a honeypot.
- *Blacklists that only arm on interaction* — an address becomes blocked after its first transfer; not reachable with a fresh synthetic holder either way.

**False negatives (sim says fine when it isn't).** Already documented in `HONEYPOT_SIM_METHOD` (L7657) and worth repeating: blocking only the LP-pair path while allowing wallet-to-wallet transfers evades a plain `transfer()` probe. `transferable:true` means "no basic transfer block found", not "sellable for sure".

**Compatibility limits.**
- *Rebasing / share-based tokens* (`stETH`-style, ERC-4626 vaults) do not store balances as a plain mapping; `balanceOf` computes from shares × rate, so no candidate returns `PROBE_VALUE` and the result is an honest `unavailable`. Correct behaviour, not a bug — the sim does not pretend.
- *Non-OpenZeppelin ERC-7201 namespaces* are not enumerated. Only `openzeppelin.storage.ERC20` is included. A custom namespace (or Solady-style fixed-seed mapping) falls outside the window ⇒ `unavailable`.
- *Custom-layout proxies* whose balance mapping sits above slot 63 for other reasons would also miss.
- *ERC-1155 / ERC-721* are out of scope — different balance model entirely.
- *No-code addresses* (`EOA`, self-destructed) fail after 1 subrequest.

**Reliability is the dominant residual failure mode, not detection.** See below.

---

## 8. Live endpoint status (`/chain/token-report/preview`)

Measured 2026-10-28 against the deployed Worker:

- **8 sequential USDC preview calls: 5 × `simStatus:"tested"`, 2 × `"unavailable"`, 1 × field absent.** An earlier 4-token sweep (usdc/weth/cbbtc/aero) returned `tested` 4/4.
- So the current state is **~70–80% `tested`**, i.e. the *inverse* of the card's "unavailable ~7/8 runs" premise. The original fixed-window bug is gone; what remains is transport flakiness under repetition — consistent with per-provider rate limiting / timeouts on eight near-simultaneous `eth_call`s carrying a ~4 KB `stateDiff` blob, plus a third failure mode where `simStatus` is missing entirely rather than `"unavailable"`.
- **No caching.** Three identical requests returned different `analyzed_at` timestamps (05:52:19 / 05:52:20 / 05:52:22) at 1.3–2.0 s each. Every request re-runs discovery. This is why rapid repetition is what surfaces the flakiness.
- **`balance_slot_index` / `slot_layout` are not exposed** on the preview response — `security` is flattened to `simStatus` plus risk booleans. Operators cannot see which slot was found, which makes a remote `unavailable` impossible to diagnose from the outside. Exposing the found slot (and the fail reason) would make this class of failure self-diagnosing.

Verdicts observed on the same calls: USDC `SAFE` / risk 25, WETH `SAFE` / 0, cbBTC `SAFE` / 25, AERO `SAFE` / 15.

---

## 9. Open items (genuinely unimplemented)

1. **Slot registry / cache.** Each request re-probes; a token's balance slot is effectively immutable (it is set by the contract's layout, and survives upgrades in the overwhelming majority of cases). Persisting `{chain, token → slot}` would cut a repeat request from 8 subrequests to 1 and remove most of the flakiness surface. *Not implemented — verified: no slot cache exists in `src/index.ts`.* Note the invalidation caveat: an upgrade can in principle change the layout, so either TTL the entry or re-verify cheaply.
2. **Multi-provider retry with backoff** on the discovery path — would convert most `unavailable` into `tested` without touching correctness.
3. **Expose `slot_layout` / fail reason** in the response so failures are diagnosable.
4. **Prove the ERC-7201 path against a live OZ-v5 namespaced token** (currently wired + costed, not yet validated on-chain).
5. **Validate against a known-bad token.** All six probes are *good* tokens; the sim's "detects a honeypot" direction is inferred from a successful transfer, not demonstrated against a confirmed honeypot. This is the biggest untested claim in the feature.
6. **Disambiguate permissioned-token reverts** from honeypot reverts, or at least surface the revert reason.

---

## 10. Reproduction

Scripts (scratch, not committed — cheap to re-run):

- `slotprobe.mjs` — raw-state pass: finds a real holder via `Transfer` logs, then matches `keccak256(pad32(holder) ++ pad32(slot))` against `eth_getStorageAt`; also dumps proxy slots and non-zero integer slots.
- `simprobe.mjs` — replicates `simulateTransferProbe()` exactly (batched `stateDiff`, binary narrowing, transfer probe); prints slot + subrequest count.
- `windowprobe.mjs` — the coverage matrix: same algorithm restricted to 0–3 / 0–10 / 0–20 / 0–63 / 0–63+7201.
- `derive.mjs` — re-derives all six proxy constants from `keccak256` and diffs them against the values in `src/index.ts`.

```bash
cd <repo> && ln -sfn node_modules ~/.hermes/profiles/prospector/cache/scratch/node_modules
node ~/.hermes/profiles/prospector/cache/scratch/derive.mjs      # 6/6 MATCH
node ~/.hermes/profiles/prospector/cache/scratch/simprobe.mjs    # 6/6 tested, 8-9 subrequests
node ~/.hermes/profiles/prospector/cache/scratch/windowprobe.mjs # coverage matrix
```

RPCs used: `https://mainnet.base.org`, `https://base-rpc.publicnode.com`, `https://base.drpc.org` (tried in order, first success wins).

---

## References

- EIP-1967 Transparent Proxy — https://eips.ethereum.org/EIPS/eip-1967
- EIP-1822 UUPS Proxies — https://eips.ethereum.org/EIPS/eip-1822
- EIP-7201 Namespaced Storage Layout — https://eips.ethereum.org/EIPS/eip-7201
- OpenZeppelin v5 upgradeable storage — https://docs.openzeppelin.com/contracts/5.x/upgradeable
- Solidity storage layout / mapping key derivation — https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html
