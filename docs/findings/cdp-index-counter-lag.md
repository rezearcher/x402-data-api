# CDP Bazaar: the quality-counter leg is unbounded, and it is not the delisting clock

Card: `t_3814c750`. Written 2026-10-28 ~09:00Z. Every number here is reproducible from
the commands in [§7](#7-reproduce).

VERDICT: there is **no non-spending trigger** that advances `quality.lastCalledAt`, and
one is **not needed**. The counter is an unreliably-delayed rollup, not a freshness
signal — a settlement is the strongest indexing event CDP documents, and our own seq 7
settlement (`extension` status `success`, on-chain receipt, `lastUpdated` +125 ms) still
moved the counter **zero** at T+98 min. The delisting clock was therefore being measured
off the wrong field. It is now measured off `lastUpdated` (synchronous), and the counter
is demoted to advisory telemetry (`scripts/monitor_delisting.py`). Nothing should be
settled to move a counter; the only remaining reason to settle is to refresh a **record**
that is genuinely approaching 30 days.

---

## 1. What the counter actually is

`/platform/v2/x402/discovery/merchant` exposes two independent clocks per record:

| field | written by | measured latency after a settlement |
|---|---|---|
| `lastUpdated` (+ re-crawled `description`) | the settlement path itself | **125 ms** (seq 7), 1.007 s (seq 1) |
| `quality.lastCalledAt`, `l30DaysTotalCalls`, `l30DaysUniquePayers` | a separate rollup | 55–81 min (seq 1), **never** as of T+98 min (seq 7) |

The rollup is what a reader of the catalog would naturally treat as "was this resource
used recently". It is not that, and the lag is not a fixed service-level: it is
**unbounded**.

### Population evidence — 259 records, whole public catalog

`logs/cdp-counter-census-2026-10-28.json` (`scripts/census_cdp_quality_lag.py`),
`delta = lastUpdated − lastCalledAt`:

| statistic | value |
|---|---|
| p50 | 0.269 s |
| p75 | 0.581 s |
| p90 | 1 962.6 s (32.7 min) |
| p95 | 5 737.7 s (1.59 h) |
| p99 | 76 389.1 s (21.2 h) |
| max | 845 488.7 s (**9.79 days**) |
| within 5 s | 228 / 259 (88.0 %) |
| within 60 s | 232 / 259 (89.6 %) |
| within 1 h | 241 / 259 (93.1 %) |
| **over 1 h** | **18 / 259 (6.9 %)** |

Longest lags, with their 30-day call volume:

```
 21.08 h    11 calls   jmt (aws.jmt.dev)
  7.01 h  1 051 calls  stableenrich /api/pdl/people-search
  4.00 h  1 250 calls  nansen /api/v1/...
  3.91 h     33 calls  402rates
  2.64 h    115 calls  x402node
  2.32 h     26 calls  hyperliquid
  2.18 h 14 628 calls  keyring
  1.76 h 30 110 calls  stableenrich /api/exa/search
  1.74 h 79 201 calls  blockrun
```

Median lag by volume bucket:

| calls/30d | n | median delta |
|---|---|---|
| 1–9 | 104 | 0.256 s |
| 10–99 | 74 | 0.303 s |
| 100–999 | 57 | 0.207 s |
| 1000+ | 24 | **2 218.9 s (37.0 min)** |

The 1000+ bucket is the tell: writes for a busy resource are **coalesced into a periodic
rollup**, so a high-volume route is *systematically* tens of minutes behind. The tail
beyond that is not a schedule at all — it is writes that simply do not happen on any
timescale we can rely on. CDP's own docs say quality/ranking metrics are recomputed on a
**six-hour schedule**, which is consistent with a 37-minute median for the busiest
records and with a 9.8-day maximum for the unlucky ones.

### Why our route, and why `api.greyridgesignals.ai/chain/token-report`

The interesting finding is that the lag is **not explained** by any property we control:

* *Not the host.* Our own host is not special: `/defi/yields` on
  `x402-data-api.sigrunner.workers.dev` shows a delta of **0.166 s**, and
  `api.greyridgesignals.ai/chain/gas-price` **1.38 s**. Same CDP, same pipeline, no lag.
* *Not the route.* `/chain/token-report` on `api.greyridgesignals.ai` shows
  `lastUpdated 06:58:44.587Z`, `lastCalledAt 06:58:48.769Z` → **+4.18 s**, i.e. the
  counter was written *after* the record and is the expected shape of a healthy write.
  The same route name on `*.workers.dev` is 7.66 days old with a **0.141 s** delta.
* *Not record age, payer count, self-vs-external settlement, or calls/30d.* Across the
  259 records every one of those cuts both ways (18 records lag >1 h, spread across
  volumes from 11 to 79 201 calls; 3 records have a counter *ahead* of the record).

So the difference is **which write that particular record's counter landed on**, and for
`/chain/token-security` it landed on a rollup that never arrived.

### Three-state observation of our own route

```
seq 1  settle 06:02:47Z  lastUpdated 06:02:47.625  lastCalledAt 06:02:46.377  → +X at ~75 min
seq 7  settle 07:14:09Z  lastUpdated 07:14:09.743  lastCalledAt 06:02:46.377  → still frozen at T+98 min
```

The counter value is *identical* across two settlements an hour apart — it is not
"slow", it is a value from before both. Its timestamp (06:02:46.377) is 1.248 s
**before** the record it accompanies, which is consistent with "the call instant is
published late", not with "the counter is behind by 75 minutes".

`scripts/check_rediscovery_verdict.py --since <seq7 settlement>` at T+98 min:

```
PASS  record.lastUpdated >= settlement: 2026-10-28T07:14:09.743Z
PASS  BUSINESS: description mentions 'scam' (buyer-intent vocabulary): 415 chars
PASS  BUSINESS: surfaced by at least one buyer-intent query:
      {"is this token a scam": 10th of 13, "token security": 7th of 11, "honeypot detector": 15th of 18}
FAIL  LAGGING: lastCalledAt advanced past settlement: 2026-10-28T06:02:46.377Z
VERDICT: INDEX-BROKEN -- business outcome landed, but the async counter is still frozen
```

Note what the two clocks disagree about: the **record and the buyer-facing outcome both
landed**; only the counter did not. The old monitor read that `FAIL` as a delisting
emergency.

---

## 2. Is there a non-spending trigger? No — and the reasoning is one line

CDP documents indexed-on-settlement as the **only** path:

* "There is no registration form or separate API call" — indexing happens after a settled payment.
* `POST /platform/v2/x402/validate` is explicitly read-only and "does not index the resource".
* The content-policy remediation path requires "another paid call" to re-trigger indexing.

So the candidates for a free trigger are: (a) validate, (b) a plain unpaid HTTP hit on the
resource, (c) traffic from other buyers, (d) waiting.

Reasoning that collapses them: **the strongest available event already failed.** A settled
payment with a verified receipt is a strictly stronger indexing event than a validation
request or an unpaid fetch. Seq 7 is that experiment, already run, already paid for: the
record moved in 125 ms and the counter did not move at all in 98 minutes. A weaker event
cannot be expected to produce a stronger side effect. Any remaining proposal reduces to
manufacturing call volume — which is precisely the pattern the fraud/abuse line forbids,
and which would corrupt the one number we are trying to measure.

(c) and (d) need no action from us: if another buyer calls the route, the counter may
advance; the record's `lastUpdated` is unaffected either way, and the delisting clock no
longer depends on the counter.

**Conclusion:** no non-spending trigger exists to test, none is required, and the correct
disposition is *stop treating the counter as a gate*. Recording that as a spend decision
is the whole point of this card.

---

## 3. The corrected delisting monitor

`scripts/monitor_delisting.py` — gates on `lastUpdated`, prints the counter only as
advisory, and never emits a settle instruction for a counter condition.

* **Thresholds:** WARN ≥ 25 d, CRITICAL ≥ 28 d, DELISTED ≥ 30 d (configurable). 25 d is
  one 5-day margin inside the documented 30-day removal rule.
* **Exit codes:** `0` healthy · `1` WARN · `2` CRITICAL **or** UNKNOWN (record present but
  `lastUpdated` unparseable — "cannot measure" is never "OK") · `3` DELISTED · `4` NO-DATA
  (empty feed is an emergency, not a pass).
* **Ledger cross-check:** joins `ledger/cdp-settlement-*.json` on `(host, route)` — *not*
  route alone, because we publish `/chain/token-report` on two hosts and a route-only key
  cross-annotates them. Flags `UNREFLECTED-SETTLEMENT` (we paid, catalog did not move) and
  `EXTERNAL-CALL-OR-REFRESH` (catalog newer than our last payment — someone else called).
* **Advisory bands** (from the census, not invented): `<60 s` normal · `60 s–1 h`
  slow-rollup · `1 h–p95` far-tail · `>p95 (5 738 s)` beyond observed p95.
* **Dedupe:** `/merchant` paging re-serves the tail of the previous page, so a raw concat
  double-prints routes (caught live: `/ai/extract` twice, 52 rows for 48 routes).

Live result, 2026-10-28T08:58:09Z:

```
routes 48   worst OK   oldest 8.63 d (/ai/extract)   min headroom 21.37 d
0 routes at WARN or worse
ADVISORY  counter 1907 s behind record  /chain/token-report    [slow-rollup]
ADVISORY  counter 4283 s behind record  /chain/token-security  [far-tail, 71 min]
```

Nothing to settle today, and no route within a week of the 25-day line. The oldest record
is `/ai/extract` at `lastUpdated 2026-10-19T17:44:32.527Z`, which crosses 25 d on
**2026-11-13T17:44Z** and 30 d on **2026-11-18T17:44Z**. Those are the next instants at
which this monitor would authorise a payment at all.

---

## 4. Residual risk, stated plainly

1. **`lastUpdated` can itself be stale.** 3 of 259 records carry a counter *more than an
   hour ahead* of `lastUpdated` (`ax1.vc`: 154 485 calls/30 d, record 9.79 days older than
   the counter; `loyalspark` 174 h; `search.gedx402` 21 h). For those, the monitor's age is
   **pessimistic** — it can fire early, never late, which is the safe direction for a
   delisting clock. The flag is `record_stale_vs_counter`, surfaced in the advisory block.
   A settlement *does* re-crawl the record (that is the 125 ms measurement), so a WARN on
   such a route is actionable rather than noise — and note this is a **record refresh**,
   not "fixing the counter".
2. **The counter may stay frozen forever on this route.** If it does, it is a CDP-side
   defect worth reporting in their Discord with this census attached — not a spend item.
   Re-sampling is free: run the census script again and compare the max/p99.
3. **The vendor's "up to 15 minutes" line is contradicted by measurement** (55–81 min for
   seq 1, >98 min for seq 7). Do not size any window off the documented number; the
   census percentiles are the honest envelope.
4. **What would change the conclusion:** a documented CDP endpoint that refreshes quality
   metrics on demand, or evidence that a second settlement from a *different* payer moves
   the counter (the rollup is per-resource, so this is not expected — but it is the one
   cheap experiment left, and it should be run deliberately, not under alarm, at 0.009 USDC).

---

## 5. What changed in the repo

| file | change |
|---|---|
| `scripts/monitor_delisting.py` | new: delisting gate on `lastUpdated`, authoritative thresholds, exit codes, ledger cross-check, advisory bands, paging dedupe |
| `scripts/census_cdp_quality_lag.py` | new: reproducible 259-record census + volume-bucket breakdown |
| `tests/test_delisting_monitor.py` | 34 regressions: boundaries, frozen-counter non-event, counter-ahead pessimism, UNKNOWN≠OK, dedupe, ledger keying, exit codes, "no remediation ever says settle to move a counter" |
| `scripts/check_rediscovery_verdict.py` | docstring + pending-window comment corrected (the lag is unbounded, not ~75 min); INDEX-BROKEN now points at the new monitor and says the counter is not the delisting clock |
| `docs/division-memory/cdp-relisting-method.md` | §3 census, §4 corrected monitor |
| `logs/cdp-counter-census-2026-10-28.json` | census evidence |
| `logs/delisting-monitor-2026-10-28.json` | first corrected-monitor run |
| `logs/cdp-rediscovery-verdict.jsonl` | third verdict run (T+98 min), evidence for the claim above |

---

## 6. Spend discipline kept

Zero USDC spent on this card. The one settlement in the window (seq 7) was authorised
before the investigation; this card's contribution is that the *next* one will not be.

The rule, in the form a future operator will read it:

> Settle to refresh a **record** (`lastUpdated`), on a schedule the monitor derives from
> the 30-day rule. Never settle to move a **counter** — the counter is CDP's rollup, it is
> unbounded, and paying for it buys nothing measurable.

## 7. Reproduce

```bash
python3 scripts/monitor_delisting.py                     # live gate; exit 0 today
python3 scripts/monitor_delisting.py --json-out /tmp/m.json
python3 scripts/census_cdp_quality_lag.py --out logs/cdp-counter-census-$(date +%F).json
python3 scripts/check_rediscovery_verdict.py --since <settlement-iso> --write-verdict logs/cdp-rediscovery-verdict.jsonl
python3 -m pytest -q tests/                              # 91 passed
```
