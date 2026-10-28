#!/usr/bin/env python3
"""reconcile_live_revenue.py — producer of the `revenue_usd_corrected` gap metric.

TWO RAILS, ONE NUMBER
    revenue_usd_corrected = organic_x402_usdc + fiat_gross_usd

  organic_x402_usdc  ~/.hermes/data/x402-revenue/latest.json :: total_external_usdc
                     Written by ~/.hermes/scripts/x402_revenue_sensor.py (cron 7,27,47):
                     on-chain USDC transfers to PAY_TO, minus the 3 documented self
                     wallets, minus dust-spam fan-out, minus pre-launch funding. This is
                     a LOWER BOUND while its `scan_complete` is false (the historical
                     backfill is still walking forward) — an understatement is the safe
                     direction for a `>= 1.0` milestone, so we surface the flag rather
                     than gate on it.
  fiat_gross_usd     GET https://x402-data-api.sigrunner.workers.dev/metrics
                     :: fiat.total_gross_usd (Stripe checkout_paid + invoice_paid, cents
                     accumulated by the UsageCounter Durable Object).

CONSUMER CONTRACT (load-bearing — do not change without re-reading milestone.sh)
  ~/.claude/skills/breathing-life/scripts/milestone.sh resolves this metric as a
  "producer file", in this order, with no help from us:
    1. ~/.hermes/data/x402-data-api/metrics/revenue_usd_corrected          bare float
       ~/.hermes/data/x402-data-api/metrics/.revenue_usd_corrected_timestamp  epoch int
    2. <board default_workdir>/.metrics/revenue_usd_corrected (+ .<name>_timestamp)
  A timestamp older than 1800 s flips the gap verdict to STALE (never MET), so this
  script must be refreshed by cron well inside that window — the 15-min entry is a
  separate card (t_b6f5ee38). A MISSING timestamp, by contrast, is silently ignored by
  milestone.sh (the value then reads as current forever), which is why we always write
  one: a dead producer must not read as healthy-forever.

WHY THE ORGANIC TERM MOVED OFF scan_state.json
  The previous implementation re-summed ~/.hermes/data/x402-revenue/scan_state.json
  transfers and kept only payers that appeared in probe_check_summary.json. That sidecar
  has been stale since 2026-08-02 and holds 2 addresses, so it discarded 389 of 504
  transfers and reported 0.005 against a real 0.80402. Repointing at
  latest.json.total_external_usdc is the sanctioned fix; the probe-check rewire is a
  board-policy dead end (t_fad358a7 archived, t_b8b2e3ef blocked as a KILL card).

DEGRADE-OPEN DISCIPLINE (and its one real limit)
  A fiat read failure — timeout, non-200, bad JSON, missing or non-numeric key — yields
  fiat_gross_usd=0 and the run still succeeds. A Stripe or Worker hiccup must never blind
  the x402 rail. The cost is that a 0 is ambiguous: "no sales yet" and "could not read"
  are the same number. The endpoint makes this worse, not better: `getFiatMetrics`
  swallows its own throw into zeros (src/usage.ts:490-515) and the handler's `degraded`
  flag covers only metrics/net_external, not fiat (src/index.ts:567), so a fiat-only
  failure is invisible server-side. We therefore cannot detect it — but we can refuse to
  hide it: every run records the read outcome on stdout (`fiat_status=`) and in
  `.revenue_usd_corrected_status.json`, so a human or QA can tell a genuine zero from an
  unread one (see known-issue 1 in docs/findings/x402_fiat_api.md).

  Deliberate asymmetry between the two rails:
    * fiat failure  -> degrade to 0 and keep going. Safe direction: this gates a
      `>= 1.0` milestone, so understating can only DELAY a MET, never false-trigger one.
    * organic failure -> preserve the last good metric and do NOT refresh the timestamp,
      so milestone.sh ages into STALE ("producer may be dead") instead of reporting a
      fabricated 0 as current reality.

EXIT CODES
  0 always. This is a cron producer: a non-zero exit gets a value discarded or a cron
  mailer tripped, and a missing metric is strictly worse than a flagged one. Problems are
  reported on stdout/stderr and in the status sidecar.

USAGE
  python3 .metrics/reconcile_live_revenue.py                    # read live, persist
  python3 .metrics/reconcile_live_revenue.py --dry-run          # read live, print only
  python3 .metrics/reconcile_live_revenue.py --dry-run --mock-fiat-usd 1.5
  python3 .metrics/reconcile_live_revenue.py --json             # status doc to stdout

  Mocking ANY term implies --dry-run: a fabricated dollar must never reach a persisted
  file, because that file is read as revenue (see the refusal in main()).
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ── Paths ──────────────────────────────────────────────────────────────────────
# Module-level so tests can redirect them (main() resolves them at call time).
HOME = os.path.expanduser("~")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

ORGANIC_PATH = os.path.join(HOME, ".hermes", "data", "x402-revenue", "latest.json")
METRICS_DIR = os.path.join(HOME, ".hermes", "data", "x402-data-api", "metrics")
GAP_METRIC_PATH = os.path.join(METRICS_DIR, "revenue_usd_corrected")
GAP_TS_PATH = os.path.join(METRICS_DIR, ".revenue_usd_corrected_timestamp")
GAP_STATUS_PATH = os.path.join(METRICS_DIR, "revenue_usd_corrected_status.json")

# Repo-local mirrors. milestone.sh only falls back to these when the HOME copy is
# absent, so they are informational — but keep them truthful or a future fallback
# silently reads a stale number.
REPO_METRIC_PATH = os.path.join(SCRIPT_DIR, "revenue_usd_corrected")
REPO_TS_PATH = os.path.join(SCRIPT_DIR, ".revenue_usd_corrected_timestamp")

# ── Fiat endpoint ──────────────────────────────────────────────────────────────
DEFAULT_METRICS_URL = "https://x402-data-api.sigrunner.workers.dev/metrics"
DEFAULT_TIMEOUT_S = 10.0
# Cloudflare in front of the Worker 403s a bare Python-urllib UA (same failure mode
# documented in x402_revenue_sensor.py for the public Base RPCs).
USER_AGENT = "x402-data-api-revenue-reconciler/1.0"


# ── Formatting / IO helpers ────────────────────────────────────────────────────
def fmt_usd(value):
    """Render a USD amount as a clean decimal string: no exponent, no trailing zeros."""
    if value == 0:
        return "0"
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _finite_usd(raw):
    """Coerce a JSON scalar to a non-negative finite float, or None.

    One place that decides what counts as a usable dollar amount: rejects bools
    (True would silently become 1.0), strings, None, NaN, inf and negatives.
    """
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    value = float(raw)
    if value != value or abs(value) == float("inf") or value < 0:
        return None
    return value


def _atomic_write(path, text):
    """Write via tmp+rename so a concurrent reader never sees a truncated value.

    milestone.sh does float(open(path).read().strip()) — a half-written file would
    parse to None and report the gap as UNRESOLVED.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w") as f:
        f.write(text)
    os.replace(tmp, path)


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Rail 1: organic on-chain x402 ──────────────────────────────────────────────
def read_organic(path=None):
    """Read total_external_usdc. -> (usd, status, detail).

    status: "ok" | "missing" | "unreadable" | "malformed"
    Never raises: a bad sidecar is a status, not a crash.
    """
    path = ORGANIC_PATH if path is None else path
    detail: dict = {"source": path}
    if not os.path.isfile(path):
        return 0.0, "missing", detail
    try:
        with open(path) as f:
            doc = json.load(f)
    except Exception as e:  # noqa: BLE001 - corrupt/partial sidecar
        return 0.0, "unreadable", dict(detail, error=str(e)[:200])
    if not isinstance(doc, dict):
        return 0.0, "malformed", dict(detail, error="top level is not a JSON object")
    raw = doc.get("total_external_usdc")
    usd = _finite_usd(raw)
    if usd is None:
        return 0.0, "malformed", dict(detail, error=f"total_external_usdc={raw!r}")
    detail.update(
        fetched_at=doc.get("fetched_at"),
        scan_complete=doc.get("scan_complete"),
        external_count=doc.get("external_count"),
        self_count=doc.get("self_count"),
        sensor_status=doc.get("status"),
    )
    return round(usd, 6), "ok", detail


# ── Rail 2: Stripe fiat, live from the Worker ──────────────────────────────────
def read_fiat(url=None, timeout=None, cache_bust=True):
    """Read fiat.total_gross_usd from the live /metrics endpoint. -> (usd, status, detail).

    status: "ok" | "unavailable:<reason>" — every failure path returns 0.0, never raises.
    Accepts HTTP 200 only: a 4xx/5xx body, a redirect or a degraded-looking payload is
    not revenue evidence.
    """
    url = DEFAULT_METRICS_URL if url is None else url
    timeout = DEFAULT_TIMEOUT_S if timeout is None else timeout
    detail: dict = {"cache_busted": bool(cache_bust)}

    if cache_bust:
        # The edge caches a healthy body for 3600 s. Bypass it: the whole point of this
        # producer is to see a fiat dollar within one cron window, not within an hour of
        # someone's TTL expiring. ~96 DO reads/day at a 15-min cadence is negligible.
        sep = "&" if urllib.parse.urlparse(url).query else "?"
        url = f"{url}{sep}cb={time.time_ns()}"
    detail["url"] = url

    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = getattr(resp, "status", None) or resp.getcode()
            body = resp.read()
    except urllib.error.HTTPError as e:
        return 0.0, f"unavailable:http_{e.code}", dict(detail, http_status=e.code)
    except Exception as e:  # noqa: BLE001 - timeout, DNS, TLS, connection reset
        return 0.0, f"unavailable:{type(e).__name__}", dict(detail, error=str(e)[:200])

    detail["http_status"] = code
    if code != 200:
        return 0.0, f"unavailable:http_{code}", detail

    try:
        doc = json.loads(body.decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001
        return 0.0, "unavailable:bad_json", dict(detail, error=str(e)[:200])
    if not isinstance(doc, dict):
        return 0.0, "unavailable:bad_json", dict(detail, error="top level is not a JSON object")

    fiat = doc.get("fiat")
    # NOTE: `degraded` here does NOT cover fiat (src/index.ts:567). Recorded anyway —
    # when it is true the snapshot is untrustworthy for EVERY block, fiat included.
    detail["endpoint_degraded"] = doc.get("degraded") is True
    detail["block_present"] = isinstance(fiat, dict)
    if not isinstance(fiat, dict):
        return 0.0, "unavailable:no_fiat_block", detail

    for event in ("checkout_paid", "invoice_paid"):
        ev = fiat.get(event)
        if isinstance(ev, dict):
            detail[event] = {"count": ev.get("count"), "gross_usd": ev.get("gross_usd")}

    raw = fiat.get("total_gross_usd")
    usd = _finite_usd(raw)
    if usd is None:
        return 0.0, "unavailable:bad_total_gross_usd", dict(detail, error=f"total_gross_usd={raw!r}")
    return round(usd, 6), "ok", detail


# ── CLI ────────────────────────────────────────────────────────────────────────
def build_parser():
    p = argparse.ArgumentParser(
        prog="reconcile_live_revenue.py",
        description="revenue_usd_corrected = organic x402 USDC + live Stripe fiat gross.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Mocking any term implies --dry-run: fabricated revenue is never persisted.\n"
            "Every run exits 0 by design (cron producer); problems land on stdout and in\n"
            "revenue_usd_corrected_status.json."
        ),
    )
    p.add_argument("--dry-run", action="store_true",
                   help="read every input and print the result, but write no files")
    p.add_argument("--mock-fiat-usd", type=float, default=None, metavar="USD",
                   help="use this fiat value instead of calling /metrics (implies --dry-run)")
    p.add_argument("--mock-organic-usd", type=float, default=None, metavar="USD",
                   help="use this organic value instead of latest.json (implies --dry-run)")
    p.add_argument("--metrics-url", default=os.environ.get("X402_METRICS_URL", DEFAULT_METRICS_URL),
                   help=f"fiat endpoint (default: {DEFAULT_METRICS_URL})")
    p.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S,
                   help=f"fiat HTTP timeout in seconds (default: {DEFAULT_TIMEOUT_S:g})")
    p.add_argument("--no-cache-bust", dest="cache_bust", action="store_false",
                   help="send the plain URL and accept a body up to the 1h edge TTL old")
    p.add_argument("--json", action="store_true",
                   help="emit the full status document as JSON on stdout")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)

    # Paths resolved from module globals at call time (tests monkeypatch them).
    paths = {
        "gap_metric": GAP_METRIC_PATH,
        "gap_ts": GAP_TS_PATH,
        "gap_status": GAP_STATUS_PATH,
        "repo_metric": REPO_METRIC_PATH,
        "repo_ts": REPO_TS_PATH,
        "organic": ORGANIC_PATH,
    }

    mocked = args.mock_fiat_usd is not None or args.mock_organic_usd is not None
    dry_run = args.dry_run or mocked
    if mocked and not args.dry_run:
        print("note: a mocked term implies --dry-run — no file will be written; "
              "fabricated revenue must never reach a persisted metric", file=sys.stderr)

    # ── Rail 1 ────────────────────────────────────────────────────────────────
    if args.mock_organic_usd is not None:
        organic_usd, organic_status = round(float(args.mock_organic_usd), 6), "mock"
        organic_detail = {"source": "mock", "requested": args.mock_organic_usd}
    else:
        organic_usd, organic_status, organic_detail = read_organic(paths["organic"])

    # ── Rail 2 ────────────────────────────────────────────────────────────────
    if args.mock_fiat_usd is not None:
        fiat_usd, fiat_status = round(float(args.mock_fiat_usd), 6), "mock"
        fiat_detail = {"url": "mock", "requested": args.mock_fiat_usd}
    else:
        fiat_usd, fiat_status, fiat_detail = read_fiat(
            url=args.metrics_url, timeout=args.timeout, cache_bust=args.cache_bust
        )

    corrected = round(organic_usd + fiat_usd, 6)

    # ── Persist? ──────────────────────────────────────────────────────────────
    persist = not dry_run
    persist_blocker = None
    if mocked:
        persist, persist_blocker = False, "mocked term (dry-run implied)"
    elif organic_status != "ok":
        # Preserve last good + let the timestamp age into STALE. Writing 0 here would
        # report a fabricated flat line as current reality.
        persist, persist_blocker = False, f"organic input {organic_status}"

    status_doc = {
        "assessed_at": _now_iso(),
        "revenue_usd_corrected": corrected,
        "components": {"organic_x402_usdc": organic_usd, "fiat_gross_usd": fiat_usd},
        "organic": dict(organic_detail, status=organic_status, usd=organic_usd),
        "fiat": dict(fiat_detail, status=fiat_status, usd=fiat_usd),
        "dry_run": dry_run,
        "mocked": mocked,
        "persisted": persist,
        "persist_blocked_because": persist_blocker,
    }

    if persist:
        _atomic_write(paths["gap_metric"], f"{fmt_usd(corrected)}\n")
        # Timestamp AFTER the value: never advertise freshness for a value that isn't there.
        _atomic_write(paths["gap_ts"], f"{int(time.time())}\n")
        _atomic_write(paths["repo_metric"], f"{fmt_usd(corrected)}\n")
        _atomic_write(paths["repo_ts"], f"{int(time.time())}\n")
        _atomic_write(paths["gap_status"], json.dumps(status_doc, indent=2) + "\n")

    if args.json:
        print(json.dumps(status_doc, indent=2))
    else:
        print(f"revenue_usd_corrected={fmt_usd(corrected)}")
        print(f"organic_x402_usdc={fmt_usd(organic_usd)}")
        print(f"fiat_gross_usd={fmt_usd(fiat_usd)}")
        print(f"organic_status={organic_status}")
        print(f"fiat_status={fiat_status}")
        print(f"x402_source={organic_detail.get('source')}")
        if organic_status == "ok":
            print(f"x402_scan_complete={str(organic_detail.get('scan_complete')).lower()}")
        print(f"persisted={str(persist).lower()}")
        if persist_blocker:
            print(f"persist_blocked_because={persist_blocker}")

    if organic_status not in ("ok", "mock"):
        print(f"warning: organic input unusable ({organic_status}) — metric NOT refreshed; "
              "milestone.sh will read STALE once the timestamp ages past 1800s",
              file=sys.stderr)
    if fiat_status.startswith("unavailable"):
        # Loud on purpose: this is the one failure direction that looks like "no sales yet".
        print(f"warning: fiat rail unavailable ({fiat_status}) — fiat term degraded to 0; "
              "check .revenue_usd_corrected_status.json before reading this as a genuine zero",
              file=sys.stderr)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - a cron producer must never crash the loop
        print(f"error: unexpected failure: {e}", file=sys.stderr)
        sys.exit(0)
