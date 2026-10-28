#!/usr/bin/env python3
"""Tests for the two-rail revenue reconciler (.metrics/reconcile_live_revenue.py).

Covers the additive contract
    revenue_usd_corrected == organic_x402_usdc + fiat_gross_usd
and, more importantly, every way the fiat rail can fail, because the failure mode that
matters is a silent 0 that is indistinguishable from "no sales yet".

No test touches the network: urllib.request.urlopen is always faked. No test writes
outside tmp_path: every output path is redirected per-test.

Run: python3 -m pytest tests/test_revenue_fiat_term.py -q
"""

import importlib.util
import json
import os
import socket
import time

import pytest

MODULE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    ".metrics",
    "reconcile_live_revenue.py",
)


# ── harness ───────────────────────────────────────────────────────────────────
class FakeResponse:
    """Minimal stand-in for http.client.HTTPResponse."""

    def __init__(self, body, status=200):
        self.status = status
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def read(self):
        return self._body

    def getcode(self):
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def metrics_payload(total_gross_usd=0, checkout=0.0, invoice=0.0, degraded=None):
    doc = {
        "total_paid_calls": 26387,
        "fiat": {
            "checkout_paid": {"count": 0, "gross_usd": checkout},
            "invoice_paid": {"count": 0, "gross_usd": invoice},
            "total_gross_usd": total_gross_usd,
        },
    }
    if degraded is not None:
        doc["degraded"] = degraded
    return doc


@pytest.fixture()
def rec(tmp_path, monkeypatch):
    """Load the script fresh and point every path at tmp_path."""
    spec = importlib.util.spec_from_file_location("reconcile_live_revenue", MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    metrics = tmp_path / "metrics"
    metrics.mkdir()
    organic = tmp_path / "latest.json"

    paths = {
        "ORGANIC_PATH": organic,
        "METRICS_DIR": metrics,
        "GAP_METRIC_PATH": metrics / "revenue_usd_corrected",
        "GAP_TS_PATH": metrics / ".revenue_usd_corrected_timestamp",
        "GAP_STATUS_PATH": metrics / "revenue_usd_corrected_status.json",
        "REPO_METRIC_PATH": tmp_path / "repo" / "revenue_usd_corrected",
        "REPO_TS_PATH": tmp_path / "repo" / ".revenue_usd_corrected_timestamp",
    }
    for name, path in paths.items():
        monkeypatch.setattr(mod, name, str(path))
    mod._organic_path = organic
    mod._paths = paths
    return mod


def write_organic(mod, total_external_usdc=0.80402, **extra):
    doc = {
        "fetched_at": "2026-10-28T05:47:01Z",
        "status": "alert",
        "scan_complete": False,
        "external_count": 388,
        "self_count": 110,
        "total_external_usdc": total_external_usdc,
    }
    doc.update(extra)
    mod._organic_path.write_text(json.dumps(doc))
    return doc


def fake_urlopen(monkeypatch, result):
    """result: FakeResponse, exception instance, or callable(req) -> either."""
    seen = []

    def _open(req, timeout=None):
        seen.append({"url": getattr(req, "full_url", None), "timeout": timeout,
                     "headers": dict(getattr(req, "headers", {}))})
        out = result(req) if callable(result) else result
        if isinstance(out, Exception):
            raise out
        return out

    monkeypatch.setattr("urllib.request.urlopen", _open)
    return seen


def out_lines(capsys):
    return capsys.readouterr().out.strip().splitlines()


def field(lines, key):
    for line in lines:
        if line.startswith(key + "="):
            return line.split("=", 1)[1]
    raise AssertionError(f"{key}= not in output: {lines}")


# ── the additive contract ─────────────────────────────────────────────────────
def test_both_terms_sum_to_the_authors_original_constant(rec, capsys):
    """0.769 organic + 1.5 fiat == 2.269, the value the card's CHECK was written against.

    Both terms are mocked so this stays true no matter how live data drifts — that is
    the entire point of pinning it here rather than grepping a live-derived number.
    """
    assert rec.main(["--dry-run", "--mock-organic-usd", "0.769", "--mock-fiat-usd", "1.5"]) == 0
    lines = out_lines(capsys)
    assert "revenue_usd_corrected=2.269" in lines
    assert field(lines, "organic_x402_usdc") == "0.769"
    assert field(lines, "fiat_gross_usd") == "1.5"


def test_live_organic_plus_live_fiat(rec, capsys, monkeypatch):
    write_organic(rec, 0.80402)
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(1.5)))
    rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics"])
    lines = out_lines(capsys)
    assert field(lines, "revenue_usd_corrected") == "2.30402"
    assert field(lines, "organic_status") == "ok"
    assert field(lines, "fiat_status") == "ok"


def test_fiat_alone_moves_a_flat_x402_line(rec, capsys, monkeypatch):
    """The card's actual purpose: a Stripe dollar must show up even with 0 on-chain."""
    write_organic(rec, 0.0)
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(1.0)))
    rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics"])
    assert "revenue_usd_corrected=1" in out_lines(capsys)


def test_real_run_persists_metric_timestamp_and_status(rec, capsys, monkeypatch):
    write_organic(rec, 0.80402)
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0.25, checkout=0.25)))
    before = int(time.time())
    assert rec.main(["--metrics-url", "http://worker.test/metrics"]) == 0

    assert rec._paths["GAP_METRIC_PATH"].read_text() == "1.05402\n"
    ts = int(rec._paths["GAP_TS_PATH"].read_text().strip())
    assert before <= ts <= int(time.time()) + 1, "timestamp must be epoch seconds, current"
    # repo mirror keeps the same value so a fallback read cannot see a different number
    assert rec._paths["REPO_METRIC_PATH"].read_text() == "1.05402\n"

    status = json.loads(rec._paths["GAP_STATUS_PATH"].read_text())
    assert status["revenue_usd_corrected"] == 1.05402
    assert status["components"] == {"organic_x402_usdc": 0.80402, "fiat_gross_usd": 0.25}
    assert status["fiat"]["status"] == "ok"
    assert status["fiat"]["checkout_paid"] == {"count": 0, "gross_usd": 0.25}
    assert status["fiat"]["http_status"] == 200
    assert status["persisted"] is True


# ── degrade-open: every fiat failure yields 0 and exit 0 ──────────────────────
@pytest.mark.parametrize(
    "failure, expected",
    [
        (lambda req: FakeResponse(b"boom", status=500), "unavailable:http_500"),
        # socket.timeout is an alias of TimeoutError on py3.10+, so both report the
        # same type name — one case is enough, kept explicit for readability.
        (socket.timeout("timed out"), "unavailable:TimeoutError"),
        (ConnectionResetError("reset"), "unavailable:ConnectionResetError"),
        (lambda req: FakeResponse(b"not json at all"), "unavailable:bad_json"),
        (lambda req: FakeResponse(b"[1,2,3]"), "unavailable:bad_json"),
        (lambda req: FakeResponse({"no_fiat_here": True}), "unavailable:no_fiat_block"),
        (lambda req: FakeResponse({"fiat": "zero"}), "unavailable:no_fiat_block"),
        (lambda req: FakeResponse({"fiat": {"total_gross_usd": "1.50"}}), "unavailable:bad_total_gross_usd"),
        (lambda req: FakeResponse({"fiat": {"total_gross_usd": None}}), "unavailable:bad_total_gross_usd"),
        (lambda req: FakeResponse({"fiat": {"total_gross_usd": True}}), "unavailable:bad_total_gross_usd"),
        (lambda req: FakeResponse({"fiat": {"total_gross_usd": -3}}), "unavailable:bad_total_gross_usd"),
        (lambda req: FakeResponse({"fiat": {}}), "unavailable:bad_total_gross_usd"),
    ],
)
def test_fiat_failures_degrade_to_zero_and_keep_going(rec, capsys, monkeypatch, failure, expected):
    write_organic(rec, 0.80402)
    fake_urlopen(monkeypatch, failure)
    assert rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics"]) == 0
    lines = out_lines(capsys)
    assert field(lines, "fiat_gross_usd") == "0"
    assert field(lines, "fiat_status") == expected
    # the other rail is untouched by a fiat failure — that is the whole point
    assert field(lines, "revenue_usd_corrected") == "0.80402"


def test_http_error_exception_is_caught(rec, capsys, monkeypatch):
    import urllib.error
    fake_urlopen(monkeypatch, urllib.error.HTTPError("u", 503, "unavailable", {}, None))
    write_organic(rec, 1.0)
    assert rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics"]) == 0
    assert field(out_lines(capsys), "fiat_status") == "unavailable:http_503"


def test_genuine_zero_is_distinguishable_from_unreadable(rec, capsys, monkeypatch):
    """The sensor's one dangerous direction: both look like 0 on stdout, so the status
    sidecar must carry the difference for QA."""
    write_organic(rec, 0.5)

    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    rec.main(["--metrics-url", "http://worker.test/metrics"])
    genuine = json.loads(rec._paths["GAP_STATUS_PATH"].read_text())
    assert genuine["components"]["fiat_gross_usd"] == 0
    assert genuine["fiat"]["status"] == "ok"
    assert genuine["fiat"]["block_present"] is True

    fake_urlopen(monkeypatch, socket.timeout("timed out"))
    capsys.readouterr()
    rec.main(["--metrics-url", "http://worker.test/metrics"])
    unread = json.loads(rec._paths["GAP_STATUS_PATH"].read_text())
    assert unread["components"]["fiat_gross_usd"] == 0
    assert unread["fiat"]["status"] != "ok"
    assert genuine != unread


def test_endpoint_degraded_flag_is_recorded(rec, capsys, monkeypatch):
    write_organic(rec, 0.0)
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0, degraded=True)))
    rec.main(["--dry-run", "--json", "--metrics-url", "http://worker.test/metrics"])
    doc = json.loads(capsys.readouterr().out)
    assert doc["fiat"]["endpoint_degraded"] is True


# ── organic rail failures must NOT fabricate a flat line ──────────────────────
def test_missing_organic_prevents_persist(rec, capsys, monkeypatch):
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(1.5)))
    assert rec.main(["--metrics-url", "http://worker.test/metrics"]) == 0
    lines = out_lines(capsys)
    assert field(lines, "organic_status") == "missing"
    assert field(lines, "persisted") == "false"
    assert not rec._paths["GAP_METRIC_PATH"].exists(), "must not write a fabricated 0"
    assert not rec._paths["GAP_TS_PATH"].exists(), "must not refresh freshness"


def test_corrupt_organic_prevents_persist(rec, capsys, monkeypatch):
    rec._organic_path.write_text("{not json")
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    assert rec.main(["--metrics-url", "http://worker.test/metrics"]) == 0
    assert field(out_lines(capsys), "organic_status") == "unreadable"
    assert not rec._paths["GAP_METRIC_PATH"].exists()


def test_malformed_organic_value(rec, capsys, monkeypatch):
    rec._organic_path.write_text(json.dumps({"total_external_usdc": "0.80"}))
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    assert rec.main(["--metrics-url", "http://worker.test/metrics"]) == 0
    assert field(out_lines(capsys), "organic_status") == "malformed"


def test_existing_metric_preserved_on_organic_failure(rec, capsys, monkeypatch):
    rec._paths["GAP_METRIC_PATH"].write_text("0.7\n")
    rec._paths["GAP_TS_PATH"].write_text("1000\n")
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    rec.main(["--metrics-url", "http://worker.test/metrics"])
    assert rec._paths["GAP_METRIC_PATH"].read_text() == "0.7\n"
    assert rec._paths["GAP_TS_PATH"].read_text() == "1000\n", "freshness must age out to STALE"


# ── mock/dry-run must never persist ───────────────────────────────────────────
def test_mocks_never_persist(rec, capsys, monkeypatch):
    write_organic(rec, 0.80402)
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(99)))  # must not even be called
    rec.main(["--mock-fiat-usd", "1.5"])  # no --dry-run on purpose
    lines = out_lines(capsys)
    assert field(lines, "persisted") == "false"
    assert field(lines, "revenue_usd_corrected") == "2.30402"
    assert not rec._paths["GAP_METRIC_PATH"].exists()
    assert not rec._paths["GAP_STATUS_PATH"].exists()


def test_dry_run_writes_nothing(rec, capsys, monkeypatch):
    write_organic(rec, 0.80402)
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(1.5)))
    rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics"])
    for key in ("GAP_METRIC_PATH", "GAP_TS_PATH", "GAP_STATUS_PATH", "REPO_METRIC_PATH"):
        assert not rec._paths[key].exists(), f"{key} written during --dry-run"


# ── request shaping ───────────────────────────────────────────────────────────
def test_cache_bust_by_default(rec, monkeypatch):
    write_organic(rec, 0.80402)
    seen = fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics"])
    assert "cb=" in seen[0]["url"], "must bypass the 1h edge cache by default"
    assert seen[0]["timeout"] == rec.DEFAULT_TIMEOUT_S


def test_no_cache_bust_flag(rec, monkeypatch):
    write_organic(rec, 0.80402)
    seen = fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    rec.main(["--dry-run", "--no-cache-bust", "--metrics-url", "http://worker.test/metrics"])
    assert "cb=" not in seen[0]["url"]


def test_cache_bust_appends_correctly_to_url_with_query(rec, monkeypatch):
    write_organic(rec, 0.0)
    seen = fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics?x=1"])
    assert "?x=1&cb=" in seen[0]["url"]


def test_requests_identify_themselves(rec, monkeypatch):
    """Cloudflare 403s a bare urllib UA on this host family."""
    write_organic(rec, 0.0)
    seen = fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics"])
    headers = {k.lower(): v for k, v in seen[0]["headers"].items()}
    assert "reconcile" in headers.get("User-agent", headers.get("user-agent", "")).lower()


def test_timeout_is_configurable(rec, monkeypatch):
    write_organic(rec, 0.0)
    seen = fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    rec.main(["--dry-run", "--timeout", "2.5", "--metrics-url", "http://worker.test/metrics"])
    assert seen[0]["timeout"] == 2.5


# ── output formatting (milestone.sh does a bare float() on the file) ──────────
@pytest.mark.parametrize(
    "value, expected",
    [(0, "0"), (0.0, "0"), (1, "1"), (1.5, "1.5"), (0.80402, "0.80402"),
     (2.30402, "2.30402"), (100.0, "100"), (0.000001, "0.000001")],
)
def test_fmt_usd_is_bare_and_float_parseable(rec, value, expected):
    out = rec.fmt_usd(value)
    assert out == expected
    assert float(out) == value
    assert "e" not in out.lower(), "no exponent notation in a producer file"


def test_persisted_file_is_float_parseable(rec, monkeypatch):
    write_organic(rec, 0.1)
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0.2)))
    rec.main(["--metrics-url", "http://worker.test/metrics"])
    # exactly how milestone.sh reads it
    assert float(rec._paths["GAP_METRIC_PATH"].read_text().strip()) == 0.3


def test_scan_complete_is_surfaced(rec, capsys, monkeypatch):
    write_organic(rec, 0.80402, scan_complete=False)
    fake_urlopen(monkeypatch, FakeResponse(metrics_payload(0)))
    rec.main(["--dry-run", "--metrics-url", "http://worker.test/metrics"])
    assert field(out_lines(capsys), "x402_scan_complete") == "false"
