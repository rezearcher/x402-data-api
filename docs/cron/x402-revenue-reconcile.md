# x402 revenue_usd_corrected — 15-minute refresher

Cron entry that keeps the `revenue_usd_corrected` gap metric fresh so a Stripe dollar
landing on the fiat rail becomes visible to `milestone.sh` within one window.

| | |
|---|---|
| Timer | `x402-revenue-reconcile.timer` — `OnCalendar=*:0/15`, `Persistent=true` |
| Service | `x402-revenue-reconcile.service` — `Type=oneshot`, `TimeoutStartSec=120` |
| Wrapper | `ops/cron/reconcile_x402_revenue.sh` (this repo, tracked) |
| Producer | `.metrics/reconcile_live_revenue.py` |
| Install | `bash ops/cron/install.sh` (uninstall: `--uninstall`) |
| Journal | `journalctl --user -t x402-revenue-reconcile` |
| Log | `~/.hermes/logs/x402-revenue-reconcile.log` (self-rotating at 5 MB) |
| Dead-man's switch | Healthchecks check `x402-revenue-reconcile` via `hc_ping.sh` |

## What it writes

The producer owns all five files and writes each one tmp+rename, value before timestamp:

```
~/.hermes/data/x402-data-api/metrics/revenue_usd_corrected            bare float
~/.hermes/data/x402-data-api/metrics/.revenue_usd_corrected_timestamp epoch int
~/.hermes/data/x402-data-api/metrics/revenue_usd_corrected_status.json per-rail outcome
.metrics/revenue_usd_corrected                                        repo mirror (untracked)
.metrics/.revenue_usd_corrected_timestamp                             repo mirror (untracked)
```

`~/.hermes/data/...` is authoritative: `milestone.sh` reads it first and only falls back
to the repo mirror when that copy is missing. Both repo mirrors are gitignored — the
producer rewrites them every 15 minutes and a tracked generated file would leave the
shared main tree permanently dirty.

## Alerting contract

**Do not alert on exit codes from `reconcile_live_revenue.py`.** It always exits 0 by
design: a cron producer that exits non-zero risks having its value discarded, and a
missing metric is strictly worse than a flagged one. Problems are reported on stdout, in
the status sidecar, and by the wrapper.

Alert on these three surfaces instead:

1. **Wrapper exit code ≠ 0** (visible via `systemctl --user --failed`). The wrapper exits
   1 when the organic rail is unusable, when the producer refuses to persist, or when the
   timestamp is still stale after the run.
2. **Timestamp age > 1800 s.** This is the primary signal. `milestone.sh` flips the gap
   verdict to `STALE` at exactly this threshold.
3. **`organic_status != ok`** in `revenue_usd_corrected_status.json`.

A stale timestamp always means **"producer broken"** — never "revenue is zero". When the
organic input is unreadable the producer deliberately preserves the last good value and
does *not* refresh the timestamp, so the metric ages into STALE rather than reporting a
fabricated flat line as current reality.

`fiat_status=unavailable:*` is a **warning**, not an error. The fiat rail degrades open
to 0 so a Stripe or Worker hiccup cannot blind the x402 rail. The cost is that a `0` is
ambiguous: "no sales yet" and "could not read" are the same number. Check the status
sidecar before reading a 0 as genuine (see `docs/findings/x402_fiat_api.md`, known
issue 1 — the `/metrics` handler's `degraded` flag does not cover fiat).

## Two failure modes this design was built to catch

Neither is hypothetical; both were live when the timer was first installed.

**1. The service aborted before running (`status=216/GROUP`).** A `User=rez` line had
been added to this *user* unit. A systemd **user** manager cannot switch identity, so the
units aborted at exec with `EXIT_GROUP` and `ExecStart` never ran — every 15 minutes,
silently, while the timer itself showed healthy. Compounding it, the corrected unit was
never `daemon-reload`ed, so systemd kept running the stale loaded definition and only
warned on `systemctl status`. Never add `User=`/`Group=` to a user unit; always
`daemon-reload` after editing. `ops/cron/install.sh` does the reload.

**2. A wrapper that stamped freshness over a dead producer.** The producer deliberately
leaves the timestamp unrefreshed when the organic rail is broken. An earlier wrapper wrote
its own timestamp on the producer's (always-zero) exit code, which converted a broken
producer into a permanently green metric — the ACCEPTANCE predicate passed while the value
was stale. The wrapper must never write the timestamp; the producer owns it.

## Single-flight

The wrapper takes an exclusive `flock` on
`~/.hermes/data/x402-data-api/metrics/.reconcile.lock` and **skips** (exit 0, `WARN` in
the log) if a previous run still holds it. Overlapping ticks would interleave the metric
and its timestamp, letting a reader see a value newer than its timestamp. A skip is
correct behaviour, not a fault; a permanently held lock surfaces as a stale timestamp.

## Manual use

```bash
bash ops/cron/reconcile_x402_revenue.sh          # run once, exactly as cron does
systemctl --user start x402-revenue-reconcile   # same, through systemd
systemctl --user list-timers x402-revenue-reconcile.timer
journalctl --user -t x402-revenue-reconcile -n 50
tail -n 50 ~/.hermes/logs/x402-revenue-reconcile.log

# the card's acceptance predicate
test $(( $(date +%s) - $(cat ~/.hermes/data/x402-data-api/metrics/.revenue_usd_corrected_timestamp) )) -lt 1800 \
  && echo PASS || echo FAIL
```
