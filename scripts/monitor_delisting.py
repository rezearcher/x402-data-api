#!/usr/bin/env python3
"""CDP Bazaar delisting monitor — keyed off `lastUpdated`, NOT `quality.lastCalledAt`.

Card t_3814c750. What changed and why
-------------------------------------
The 30-day rule is real and vendor-documented: "Resources that go 30 days without a
settlement are removed from both the catalog and search results"
(docs.cdp.coinbase.com/x402/seller/get-discovered.md). The monitor for that rule used
to key off `min(quality.lastCalledAt)`. That field is the wrong instrument:

  `lastUpdated`      is written per settled call. Measured on our own record:
                     settlement 2026-10-28T07:14:09.618Z -> lastUpdated 07:14:09.743Z
                     = 125 ms. seq 1 was 1.007 s. This is the settlement trace.

  `quality.*`        is a rollup, not a per-call write. A 259-record census of the
                     public catalog (logs/cdp-counter-census-2026-10-28.json) shows
                     it is normally within 5 s (88.0%), but the tail is unbounded:
                     p90 33 min, p95 1.6 h, p99 21 h, max 9.8 days. Records with
                     1000+ calls/30d coalesce into batch flushes (bucket median
                     37 min). Our /chain/token-security sat frozen at
                     2026-10-28T06:02:46.377Z for >95 min across 45 samples after a
                     *successful, on-chain-confirmed* settlement at 07:14:09Z whose
                     extension status was `success` — i.e. a settle is not even
                     sufficient to force the counter to move.

So a monitor keyed on lastCalledAt fires falsely (pressuring us to buy settlements
that buy nothing) and can also miss the real 30-day clock. This monitor:

  * gates on `lastUpdated` — the synchronous settlement trace,
  * reports `quality.*` as ADVISORY telemetry, with the census p95 as the line
    between "normal" and "in the observed tail",
  * never emits a remediation that tells an operator to settle in order to move a
    counter. The only legitimate settlement is one that (a) publishes a changed
    description, or (b) refreshes a route that is genuinely inside the staleness
    window — and the description must already be live on the Worker.

Also cross-checks `ledger/cdp-settlement-*.json` (self-settlements we know about):
  ledger newer than the catalog  -> UNREFLECTED settlement (a real defect worth a card)
  catalog newer than the ledger  -> an external paid call or an independent refresh
                                    (good news: the route is alive without our spend)

Read-only: GET /discovery/merchant only. Never settles, never verifies, never writes.

Statuses / exit codes
  0  OK        every catalogued route is comfortably inside the window
  1  WARN      a route is older than --warn-days (default 25) — plan one settlement,
               description deployed first
  2  CRITICAL  a route is older than --critical-days (default 28) or its age cannot
               be measured (UNKNOWN)
  3  DELISTED  a route is at/past --delist-days (default 30): CDP will/has removed it
  4  NO DATA   no records at all for this payTo — wrong payTo, or wholesale removal

Usage
  python3 scripts/monitor_delisting.py
  python3 scripts/monitor_delisting.py --json-out logs/delisting-monitor.json
  python3 scripts/monitor_delisting.py --from-file fixture.json --now 2026-10-28T09:00:00Z
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

API = "https://api.cdp.coinbase.com/platform/v2/x402/discovery"
PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10"

DEFAULT_WARN_DAYS = 25.0
DEFAULT_CRITICAL_DAYS = 28.0
DEFAULT_DELIST_DAYS = 30.0

# Census (259 catalog records, logs/cdp-counter-census-2026-10-28.json):
#   89.6%   |lastUpdated - lastCalledAt| <= 60 s     <- normal
#   p90 1963 s, p95 5738 s, p99 21 h, max 9.8 days   <- the tail is unbounded
# Both lines are REPORTING lines only. Neither ever changes a status and neither
# ever produces a "settle to fix it" instruction.
COUNTER_ADVISORY_SECONDS = 60.0
COUNTER_TAIL_SECONDS = 5737.0

STATUS_EXIT = {"OK": 0, "WARN": 1, "CRITICAL": 2, "UNKNOWN": 2, "DELISTED": 3, "NO-DATA": 4}


# --------------------------------------------------------------------------- time
def ts(value):
    """Parse an ISO-8601 instant. Never compare these as strings: '...47.625Z'
    sorts BEFORE '...47Z' lexicographically and silently inverts the answer."""
    if not value:
        return None
    v = str(value).strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    if "." in v:
        head, _, tail = v.partition(".")
        n = 0
        while n < len(tail) and tail[n].isdigit():
            n += 1
        frac, rest = tail[:n], tail[n:]
        v = f"{head}.{frac[:6].ljust(6, '0')}{rest or '+00:00'}"
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    # normalise to UTC: a record may legitimately carry an offset, and comparing
    # aware datetimes is correct but leaves the printed offset in place, which
    # makes an "is this the same hour?" reading of the output wrong.
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


# ------------------------------------------------------------------- classification
def route_of(record):
    """'/chain/token-security' from the resource URL; the catalog keys on the URL."""
    res = (record.get("resource") or "").rstrip("/")
    if "://" in res:
        rest = res.split("://", 1)[1]
        if "/" in rest:
            return "/" + rest.split("/", 1)[1]
        return "/"
    return res or "(unknown)"


def _counter_band(drift):
    """Where this record's counter lag sits in the measured catalog distribution."""
    if drift is None:
        return "unmeasurable"
    if drift < 0:
        return "counter-ahead-of-record"
    if drift < COUNTER_ADVISORY_SECONDS:
        return "normal (89.6% of catalog <=60s)"
    if drift < 3600.0:
        return "slow-rollup (>60s, <1h)"
    if drift < COUNTER_TAIL_SECONDS:
        return "far-tail (>1h, under p95)"
    return "beyond-observed-p95"


def classify(record, now, warn_days=DEFAULT_WARN_DAYS,
             critical_days=DEFAULT_CRITICAL_DAYS, delist_days=DEFAULT_DELIST_DAYS):
    """One route's delisting verdict, from the SYNCHRONOUS field only.

    `lastUpdated` is the gate. `quality.lastCalledAt` is carried as telemetry; it can
    be days behind and must never change the status (that bug cost two false
    INDEX-BROKEN verdicts on 2026-10-28 and nearly bought a settlement that would
    have moved nothing)."""
    q = record.get("quality") or {}
    lu = ts(record.get("lastUpdated"))
    lc = ts(q.get("lastCalledAt"))
    out = {
        "resource": record.get("resource"),
        "route": route_of(record),
        "last_updated": record.get("lastUpdated"),
        "last_called_at": q.get("lastCalledAt"),
        "calls30d": q.get("l30DaysTotalCalls"),
        "payers30d": q.get("l30DaysUniquePayers"),
        "gate_field": "lastUpdated",
    }
    if lu is None:
        out.update({"status": "UNKNOWN", "age_days": None, "days_to_delist": None,
                    "reason": "no parseable lastUpdated — cannot measure the 30-day clock"})
        return out

    age_days = (now - lu).total_seconds() / 86400.0
    if age_days >= delist_days:
        status = "DELISTED"
    elif age_days >= critical_days:
        status = "CRITICAL"
    elif age_days >= warn_days:
        status = "WARN"
    else:
        status = "OK"

    drift = (lu - lc).total_seconds() if lc else None
    out.update({
        "status": status,
        "age_days": round(age_days, 3),
        "days_to_delist": round(delist_days - age_days, 3),
        "counter_drift_s": round(drift, 3) if drift is not None else None,
        "counter_flagged": bool(drift is not None and drift >= COUNTER_ADVISORY_SECONDS),
        "counter_in_tail": bool(drift is not None and drift >= COUNTER_TAIL_SECONDS),
        "counter_band": _counter_band(drift),
        "counter_ahead_of_record": bool(drift is not None and drift < -60),
        # 3 of 259 catalog records carry a counter more than an hour AHEAD of
        # lastUpdated (ax1.vc: 154k calls/30d, record 10 days older than the
        # counter). For those the monitor's age is pessimistic, which is the safe
        # direction for a delisting clock: it can fire early, never late. One
        # settlement re-crawls the record (measured 125 ms), which is the correct
        # fix here -- and note this is a RECORD refresh, not "fixing the counter".
        "record_stale_vs_counter": bool(drift is not None and drift < -3600),
    })
    return out


def dedupe(records):
    """One row per resource. /merchant pagination OVERLAPS: page 2 re-serves the
    tail of page 1, so a raw concat double-prints routes and double-counts them in
    the summary. Keep the record carrying the newest lastUpdated."""
    best = {}
    for r in records:
        key = (r.get("resource") or "").strip()
        if not key:
            continue
        prev = best.get(key)
        if prev is None:
            best[key] = r
            continue
        if (ts(r.get("lastUpdated")) or datetime.min.replace(tzinfo=timezone.utc)) > \
           (ts(prev.get("lastUpdated")) or datetime.min.replace(tzinfo=timezone.utc)):
            best[key] = r
    return list(best.values())


def decide(verdicts):
    """Aggregate one exit code: worst route wins. NO-DATA when there is nothing to
    measure at all (an empty merchant feed is itself an emergency, not an OK)."""
    if not verdicts:
        return "NO-DATA", STATUS_EXIT["NO-DATA"]
    order = ["DELISTED", "UNKNOWN", "CRITICAL", "WARN", "OK"]
    present = {v["status"] for v in verdicts}
    for status in order:
        if status in present:
            return status, STATUS_EXIT[status]
    return "OK", 0


# ------------------------------------------------------------------- ledger x-check
def _key(url):
    """(host, path) — the catalog holds the SAME route on several hosts (we have
    /chain/token-report on both api.greyridgesignals.ai and *.workers.dev), so a
    route-only key silently cross-annotates two different records."""
    u = (url or "").strip().rstrip("/")
    if "://" not in u:
        return ("", u)
    rest = u.split("://", 1)[1]
    host, _, path = rest.partition("/")
    return (host.lower(), "/" + path)


def ledger_last_settlements(paths):
    """{(host, route): datetime} of the newest self-settlement per resource."""
    newest = {}
    for path in paths:
        try:
            with open(path) as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            continue
        for entry in doc.get("entries") or []:
            ep = entry.get("endpoint") or {}
            route, url, host = ep.get("route") or "", ep.get("url") or "", ep.get("host") or ""
            when = ts(entry.get("settled_at"))
            if not route or when is None:
                continue
            key = _key(url) if url else (host.lower(), route)
            if key not in newest or when > newest[key]:
                newest[key] = when
    return newest


def annotate_ledger(verdict, ledger):
    when = ledger.get(_key(verdict.get("resource")))
    if when is None:
        verdict["ledger_last_settlement"] = None
        return verdict
    verdict["ledger_last_settlement"] = when.strftime("%Y-%m-%dT%H:%M:%SZ")
    lu = ts(verdict.get("last_updated"))
    if lu is None:
        return verdict
    gap_s = (lu - when).total_seconds()
    if gap_s < -300:          # catalog is older than a settlement we know landed
        verdict["ledger_vs_catalog"] = "UNREFLECTED-SETTLEMENT"
    elif gap_s > 3600:        # catalog moved without us paying
        verdict["ledger_vs_catalog"] = "EXTERNAL-CALL-OR-REFRESH"
    else:
        verdict["ledger_vs_catalog"] = "CONSISTENT"
    return verdict


# ------------------------------------------------------------------------- inputs
def load_from_file(path):
    with open(path) as fh:
        doc = json.load(fh)
    if isinstance(doc, list):
        return doc
    return doc.get("resources") or doc.get("items") or []


def fetch_records(pay_to=PAY_TO, max_pages=8):
    records = []
    for offset in range(0, max_pages * 20, 20):
        url = f"{API}/merchant?payTo={pay_to}&limit=20&offset={offset}"
        req = urllib.request.Request(url, headers={"accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.load(r)
        items = d.get("resources") or d.get("items") or []
        records.extend(items)
        if len(items) < 20:
            break
    return records


# ---------------------------------------------------------------------- reporting
def remediation_for(status, verdict=None):
    """The next action for a status. Deliberately has NO path that says 'settle to
    make the counter move' — that instruction is how the fraud line gets crossed."""
    if status == "OK":
        return ("none. Counter lag (advisory) is CDP's rollup, not a call signal: "
                "do not settle to advance lastCalledAt.")
    if status == "WARN":
        return ("plan ONE settlement inside the window — and only after the description "
                "you want indexed is already live on the Worker "
                "(curl -s <resource> | grep -qi <buyer vocabulary>). Guard first: "
                "python3 scripts/cdp_settlement_ledger.py guard --route <route>")
    if status == "CRITICAL":
        return ("settle once now if and only if the served 402 already carries the "
                "description you want published; ledger guard first. Never settle twice "
                "in a row to 'unstick' anything.")
    if status == "DELISTED":
        return ("already removed or about to be: one settlement re-indexes it, but the "
                "description must be deployed FIRST — settle-then-fix republishes the old text.")
    return ("cannot measure: confirm the payTo/feed is correct before acting. Do not "
            "settle blind.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pay-to", default=PAY_TO)
    ap.add_argument("--warn-days", type=float, default=DEFAULT_WARN_DAYS)
    ap.add_argument("--critical-days", type=float, default=DEFAULT_CRITICAL_DAYS)
    ap.add_argument("--delist-days", type=float, default=DEFAULT_DELIST_DAYS)
    ap.add_argument("--now", default="", help="pin the wall clock (ISO-8601) — tests/replays")
    ap.add_argument("--from-file", default="", help="read records from a JSON fixture instead of the network")
    ap.add_argument("--ledger", nargs="*", default=None,
                    help="ledger files for the self-settlement cross-check (default: ledger/cdp-settlement-*.json)")
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()

    now = ts(args.now) if args.now else datetime.now(timezone.utc)
    if now is None:
        print(f"--now is not a parseable instant: {args.now!r}")
        return 4

    if args.from_file:
        records = dedupe(load_from_file(args.from_file))
    else:
        try:
            records = dedupe(fetch_records(args.pay_to))
        except Exception as e:
            print(f"NO DATA: merchant feed unreachable ({type(e).__name__}: {e})")
            return 4

    verdicts = [classify(r, now, args.warn_days, args.critical_days, args.delist_days)
                for r in records]

    project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    paths = args.ledger if args.ledger is not None else sorted(glob.glob(os.path.join(project, "ledger", "cdp-settlement-*.json")))
    ledger = ledger_last_settlements(paths)
    verdicts = [annotate_ledger(v, ledger) for v in verdicts]

    status, code = decide(verdicts)

    print(f"CDP delisting monitor @ {now.strftime('%Y-%m-%dT%H:%M:%SZ')}")
    print(f"payTo {args.pay_to}   routes {len(verdicts)}   "
          f"window: warn {args.warn_days:g}d / critical {args.critical_days:g}d / delist {args.delist_days:g}d")
    print(f"gate field: lastUpdated (synchronous). quality.lastCalledAt = ADVISORY only.\n")

    for v in sorted(verdicts, key=lambda x: -(x.get("age_days") or 1e9)):
        age = "n/a" if v.get("age_days") is None else f"{v['age_days']:.2f}d"
        print(f"{v['status']:<9} {age:>8}  left={v.get('days_to_delist')}  "
              f"calls30d={v.get('calls30d')} payers={v.get('payers30d')}  {v['route']}")

    tail = [v for v in verdicts if v.get("counter_flagged")]
    ahead = [v for v in verdicts if v.get("counter_ahead_of_record")]
    odd = [v for v in verdicts if v.get("ledger_vs_catalog") in ("UNREFLECTED-SETTLEMENT", "EXTERNAL-CALL-OR-REFRESH")]
    if tail or ahead or odd:
        print("\nADVISORY (telemetry — no action, and specifically no settlement):")
        for v in tail:
            print(f"  counter {v['counter_drift_s']:8.0f}s behind record  {v['route']:<34} "
                  f"[{v.get('counter_band')}]")
        for v in ahead:
            note = ("RECORD IS OLDER THAN THE COUNTER -- age above reads pessimistic "
                    "(early, never late)" if v.get("record_stale_vs_counter")
                    else "a call landed a moment after the record snapshot")
            print(f"  counter ahead of record by {-v['counter_drift_s']:6.0f}s  {v['route']}  ({note})")
        for v in odd:
            print(f"  {v['ledger_vs_catalog']:<26} {v['route']}  ledger={v.get('ledger_last_settlement')} "
                  f"catalog={v.get('last_updated')}")

    print(f"\nworst: {status}")
    print(f"next: {remediation_for(status)}")
    print(f"exit {code}")

    if args.json_out:
        with open(args.json_out, "w") as fh:
            json.dump({"observed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "pay_to": args.pay_to, "worst": status, "exit_code": code,
                       "thresholds": {"warn_days": args.warn_days,
                                      "critical_days": args.critical_days,
                                      "delist_days": args.delist_days},
                       "counter_tail_seconds": COUNTER_TAIL_SECONDS,
                       "routes": verdicts}, fh, indent=1, sort_keys=True)
        print(f"wrote {args.json_out}")
    return code


if __name__ == "__main__":
    sys.exit(main())
