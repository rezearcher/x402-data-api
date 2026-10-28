# CDP Bazaar re-listing: the method (do not research this again)

**Status:** proven end-to-end 2026-10-28. **Cost of the whole lesson:** 0.068 USDC, all
recirculated to our own payee, zero external revenue.
**Ledger of record:** `ledger/cdp-settlement-2026-10-28.json` (INSERT-only, hash-chained).
**Verifier:** `python3 scripts/check_rediscovery_verdict.py --since <settlement_ts> [--write-verdict logs/cdp-rediscovery-verdict.jsonl]`
(exit **0** = RE-LISTED, **2** = PENDING inside the async window, **1** = INDEX-BROKEN or NOT RE-LISTED)
**Ledger tool:** `python3 scripts/cdp_settlement_ledger.py {audit,append,verify,show}`

---

## 1. The mechanism in one paragraph

Coinbase's CDP Bazaar catalog (the `/discovery/*` surface agents actually buy from) is
**not** refreshed by edits, by deploys, or by time. It is refreshed by a **settled paid
call routed through the CDP facilitator** for that resource. The settlement is what
republishes the snapshot: `lastUpdated` moves to the settlement second, the stored
description is re-crawled from whatever the live 402 serves *at that moment*, and the
index/quality counters (`lastCalledAt`, `l30DaysTotalCalls`, `l30DaysUniquePayers`) are
updated **asynchronously, on their own clock**. A resource with no settlement for
**30 days** is removed from the catalog *and* from search.

Consequence that cost a wasted settlement: **deploy first, settle second — they are one
coupled action.** Settling before the new description is live on the Worker republishes
the old text and buys nothing.

## 2. The exact flow (reproduce this)

1. **Publish the description you want indexed, and verify it live.**
   `curl -s https://x402-data-api.sigrunner.workers.dev/chain/token-security | grep -qi scam`
   The 402 body must already advertise the buyer vocabulary. The catalog snapshots *the
   served 402*, never `src/index.ts`, never a client-side override, never the repo.
2. **Pre-spend gate (fails closed, spends nothing):**
   `node scripts/wallet_settlement_gate.js --route /chain/token-security`
   Proves key→address, balance, live quote, payTo, asset, network, and signs a real
   EIP-3009 payload in dry-run. 17 checks. Run it immediately before spending.
3. **One settlement — exactly one, never a loop:**
   `RAPIDAPI_PROXY_SECRET=... node scripts/settle_once.js --route /chain/token-security --purpose "..."`
   Its first gate is the ledger guard: if `cdp_settlement_ledger.py guard` finds this
   route already settled inside 25 days it exits 2 without touching the network, and if
   the ledger cannot be read or does not verify it refuses rather than spend blind (§7).
   The facilitator path is `POST https://api.cdp.coinbase.com/platform/v2/x402/settle`,
   **verify first**, body `{x402Version:2, paymentPayload, paymentRequirements}`, Bearer
   CDP JWT bound to the path, reached in our stack through the `/internal/cdp-settle-raw`
   relay (`X-RapidAPI-Proxy-Secret`). The bazaar proof is in the `EXTENSION-RESPONSES`
   header, not in the HTTP 200.
4. **Confirm the money independently of the API:**
   `node scripts/verify_settlement_tx.js --route /chain/token-security`
   An HTTP 200 from settle is **not** payment. Only the Base receipt proves it: status,
   block, and exactly one USDC `Transfer` from buyer to payee. `bazaar: processing` still
   means money moved.
5. **Verify re-listing ~15 min later, and again at +2 h:**
   `python3 scripts/check_rediscovery_verdict.py --since <settlement ISO ts>`
   Exit 0 = re-listed. Exit 1 prints which leg failed.
6. **Record the measurement.** The settle-time ledger entry is written by step 3
   automatically; what is left is the `re_listing: PENDING` placeholder, resolved by
   **appending** a follow-up measurement entry (§6, §7). A settlement that is not in the
   ledger did not happen, for audit purposes.

## 3. What "re-listed" actually means — and the acceptance string that can never pass

The card-level acceptance `curl -s 'https://UNKNOWN/discovery/resources?q=x402-data-api'`
is **unsatisfiable**: the host is a literal placeholder, and `/discovery/resources`
**silently ignores `q`/`query`** (proven with a negative control — the unfiltered total
is byte-identical with and without the filter, ~90,738 items). Do not re-derive this.

Use these three measurable legs instead:

| leg | endpoint | pass condition |
|---|---|---|
| record written | `/discovery/merchant?payTo=<payTo>&limit=20&offset=N` | `lastUpdated` >= settlement ts |
| index advanced | same record, `quality.lastCalledAt` | `lastCalledAt` > settlement ts **and** `l30DaysTotalCalls` incremented |
| buyers can find us | `/discovery/search?query=<buyer intent>&limit=20` | our `resource` appears in ranks |

**`lastUpdated` moving is not re-listing.** The proof that matters is search: after this
method was applied, `is this token a scam` went from **0 of 14 to rank 10 of 13**.

**Index lag is variable and long — do not call it broken early.** Measured on the same
day, same catalog:

| route / host | call → `lastCalledAt` lag |
|---|---|
| `api.greyridgesignals.ai/chain/token-report` | **~4 seconds** |
| `x402-data-api.sigrunner.workers.dev/chain/token-security` | **~75 minutes** |

The QA pass at +55 min concluded "the async index never completed". It completed 20
minutes later. **Treat < 90 min as pending, not failed**, and never settle again to
"unstick" it — that is how the fraud line gets crossed.

**T+30 is not a verdict, and it is now machine-enforced.** Two independent passes on
2026-10-28 (t_6503d66f at +55 min, t_d5138bac at +31 min) both read the frozen counter and
concluded "index broken / never completed" while the index was still in flight. The second
one is the dangerous shape: the old verifier's FAIL remediation printed
`node scripts/settle_once.js` — i.e. the tool's own error path told the operator to spend
another 0.009 USDC to unstick a leg that was merely slow. The verifier now:

- gates on the **business outcome** (415-char description published + a buyer-intent query
  surfacing us at rank 10/13, 7/11, 15/18), which lands synchronously with the settlement;
- reports `lastCalledAt`/`l30DaysTotalCalls` as a **lagging indicator**, not a gate;
- returns exit **2 PENDING** inside `--pending-window-minutes` (default 90) and prints
  "do NOT settle again";
- only returns exit **1 INDEX-BROKEN** once the window has expired with the counter still
  frozen — and even then the remediation is *escalate a card*, never *re-settle*.

Corollary for orchestrators: do not create a fixed-delay re-check card ("verify at +30 min").
Either poll `--write-verdict` until it exits 0 or 1, or re-check at +90 min. A card with a
30-minute deadline will systematically produce a false INDEX-BROKEN.

### Seq 7 outcome (2026-10-28, the second measurement)

| settlement | `lastCalledAt` flipped at | lag |
|---|---|---|
| seq 1 — 06:02:47Z | between 06:57Z and 07:23Z | 55–81 min |
| seq 7 — 07:14:09Z | **not by 08:44Z** | **> 90 min (window expired)** |

So the 75-minute figure is **not a bound** — it is one sample of an unbounded, variable
lag. Seq 7 outran even that. Two consequences:

1. **Product truth:** the counter is not what makes us buyable. The buyer-facing outcome
   (415-char description + rank 10/13, 7/11, 15/18) landed synchronously at settlement and
   was stable for the entire 90-minute watch. `lastCalledAt` is telemetry about CDP's own
   bookkeeping; do not gate re-listing on it and do not pay to advance it.
2. **Safety truth:** `>90 min` is the point to *escalate*, never the point to re-settle.
   Seq 7's counter may still flip later; that changes nothing about the verdict being
   "do not spend".

Trajectory evidence: `logs/cdp-index-latency-probe.jsonl` (45 reads, 120s apart, read-only).

## 4. The 30-day window and the monitoring that prevents a re-delisting

- A resource with **no settlement for 30 days** is dropped from catalog *and* search.
  The 2026-10-20 cohort of our routes (last called 10-19..10-27) ages out on **2026-11-19**.
- Ranking is refreshed on a ~6-hourly cadence and weighted by **payer depth**, which is
  why one self-settlement can restore *presence and vocabulary match* but cannot buy rank.
- **Monitoring (this is the part that keeps us listed):** assert
  `min(lastCalledAt over all our catalogued routes) > now - 25 days`. Anything inside
  5 days of the cliff gets one settlement, with the description already deployed.
  Never batch, never loop, never settle twice in a row to climb rank.
- **One genuine external paid call is worth more than any self-settlement**: it moves
  `l30DaysUniquePayers` off 1 and is the only thing that raises rank.

## 5. Numbers, so nobody re-measures them

| item | value |
|---|---|
| `/chain/token-security` | 9000 units = **0.009 USDC** |
| `/chain/token-report` | 10000 units = **0.010 USDC** |
| `/chain/fee-estimate` | 2000 units = 0.002 USDC |
| `/pm/markets` | 5000 units = 0.005 USDC |
| facilitator fee | **$0 for the first 1,000 settlements/month** |
| gas | paid by the facilitator; buyer needs **0 ETH** (EIP-3009) |
| net cost | **≈ $0** — payer is our buyer wallet, payee is our own `PAY_TO` |
| catalogue size observed | 89,579–90,738 items, 20 per page |
| `/discovery/resources` rate limit | **HTTP 429 after ~500 paginated requests** |

## 6. Capital accounting: this is spend, never revenue

Every settlement above is a **self-settlement**: payer `0xC4852c…2d1e` (our controlled
buyer wallet) → payee `0x5765ae06…ed10` (our own `PAY_TO`). Both are `SELF_ADDRS` in
`scripts/verify_revenue_ledger.py` and `SELF_PAYERS` in `src/index.ts`; the relay writes
no revenue row, and every ledger entry carries `revenue_recognized_usdc: 0.0`.

- **Fraud line:** never repeat settlements to inflate `l30DaysTotalCalls`. Five
  self-settlements on one route within 13 minutes (2026-10-28, `/chain/token-report`)
  produces a publicly visible **5 calls / 1 payer** record — exactly the 1-payer/1-call
  pattern third-party de-washers (`wknipe`, `x402-measure`, `x402rep`) flag as wash.
- **Legitimate reason to settle:** (a) re-publish a changed description, (b) refresh a
  route inside the 25-day staleness window, (c) prove a paid route works after a deploy.
  Each reason is recorded in the entry's `purpose` field. "Testing" twice on the same
  route with the same unchanged description is not a reason.

## 7. Two defects this work exposed — both fixed 2026-10-28 (card t_4ed8918e)

1. **The settlement log is append-only now, and it is still not the audit trail.**
   Each run used to rewrite `logs/cdp-settlement-tx.log`; the 07:14 settlement deleted
   the 06:02 settlement's three lines (git diff: 3 deletions / 2 insertions). Every
   write is now `fs.appendFileSync(..., {flags:'a'})` and nothing may truncate, rewrite
   or "clean" it. **The ledger remains the record of record**; the log is the
   convenience journal.
   *Why it was being rewritten:* `verify_settlement_tx.js` treated **any**
   `settlement_confirmed` line as "already confirmed — no-op", so the only way to get a
   second settlement verified was to empty the log first. That check is now per-tx
   (`tx=<hash>` must match the attempt being verified), so there is no longer a reason
   to touch the file.
2. **Idempotency is keyed on the ledger, never on the log.**
   `settle_once.js` used to grep the log for `settlement_confirmed`. Because the guard's
   key was the same file the evidence lived in, archiving evidence *disabled the guard*
   — and because the log was rewritten per run, the guard re-armed and a second
   settlement ran on a one-call card. The guard now shells out to
   `python3 scripts/cdp_settlement_ledger.py guard --route <r> --window-days 25`:

   | guard exit | meaning | settle_once.js |
   |---|---|---|
   | 0 | no entry for this route in the window | proceed to the pre-spend gates |
   | 2 | route already settled inside the window | refuse (exit 2) |
   | 1 | ledger missing / unreadable / chain fails `verify` | refuse (exit 1) — **fail closed** |

   On success the run appends its own ledger entry (tx, amount, endpoint, settled_at,
   `re_listing` placeholder, `extension_status`) before it writes the journal line, so
   "settled but unledgered" is a loud exit 3 with a `ledger/.pending-unledgered-<tx>.json`
   to replay — not a silent gap the guard cannot see.
   The `re_listing: PENDING` placeholder is resolved by **appending** a measurement
   entry later; editing it in place would break the hash chain for every later entry.

   Only the honest path is left: `python3 scripts/cdp_settlement_ledger.py guard --route /chain/token-security`
   prints exactly which `seq`/`tx` blocks a re-settlement, so a refusal is evidence
   rather than a mystery.

## 8. One-liner runbook

```bash
cd ~/projects/x402-data-api
# 0. description live?
curl -s https://x402-data-api.sigrunner.workers.dev/chain/token-security | grep -qi scam
# 1. is this route even allowed to settle? (exit 2 = already settled inside 25d)
python3 scripts/cdp_settlement_ledger.py guard --route /chain/token-security
# 2. gate
node scripts/wallet_settlement_gate.js --route /chain/token-security
# 3. settle once — it re-runs step 1 itself, then appends its own ledger entry
RAPIDAPI_PROXY_SECRET=$RAPIDAPI_PROXY_SECRET node scripts/settle_once.js --route /chain/token-security --purpose "why this settlement is legitimate"
# 4. money truth
node scripts/verify_settlement_tx.js --route /chain/token-security
# 5. index truth (run at +15 min and +2 h)
python3 scripts/check_rediscovery_verdict.py --since "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# 6. record the MEASUREMENT — append a follow-up entry, never edit the settle-time one
python3 scripts/cdp_settlement_ledger.py append --entry "$(cat /tmp/measurement.json)"
python3 scripts/cdp_settlement_ledger.py verify
```

## 9. Provenance

- Settlement mechanism + vendor docs: `docs/findings/cdp-settlement-flow.md` (commit 137d6bb)
- Wallet/quote gate: `docs/wallet-settlement-ready.txt` (commit e36f715)
- Negative re-listing measurement + harness: `logs/cdp-rediscovery-proof.json` (commit a144c23)
- Chain audit of all 7 transfers: `python3 scripts/cdp_settlement_ledger.py audit --days 1`
- Ledger: `ledger/cdp-settlement-2026-10-28.json`
