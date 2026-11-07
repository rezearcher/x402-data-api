#!/usr/bin/env python3
"""Tests for scripts/worker_ledger_revenue.py. No network, no secrets, no writes outside tmp_path.

Run: python3 -m pytest tests/test_worker_ledger_revenue.py -q
"""
import importlib.util
import json
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("wlr", os.path.join(ROOT, "scripts", "worker_ledger_revenue.py"))
wlr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wlr)

SELF = {"0xaaaa000000000000000000000000000000000001"}
PRICES = {"/defi/yields": 0.001, "/chain/storage-at": 0.002, "/dns": 0.01, "/chain/token-security": 0.009}


def test_manifest_prices_parses_path_and_price():
    m = {"resources": [
        {"resource": "https://x.example/defi/yields", "price_usdc": "0.001"},
        {"resource": "https://x.example/bad", "price_usdc": "n/a"},
    ]}
    assert wlr.manifest_prices(m) == {"/defi/yields": 0.001}


def test_templated_paths_normalised():
    assert wlr.normalize_path("/dns/{domain}") == "/dns"
    assert wlr.normalize_path("/defi/yields") == "/defi/yields"


def test_self_and_unknown_excluded_from_revenue():
    rows = [
        {"path": "/defi/yields", "payer": "0xAAAA000000000000000000000000000000000001", "count": 9},
        {"path": "/defi/yields", "payer": "unknown", "count": 4},
        {"path": "/defi/yields", "payer": "0xb1", "count": 2},
    ]
    out = wlr.build_ledger(rows, PRICES, SELF)
    assert out["external_calls"] == 2
    assert out["ledger_usdc"] == pytest.approx(0.002)
    assert out["self_calls"] == 9 and out["unknown_calls"] == 4


def test_repeat_and_sweep_classification():
    rows = [
        # sweeper: 3 routes once each
        {"path": "/defi/yields", "payer": "0xs", "count": 1},
        {"path": "/chain/storage-at", "payer": "0xs", "count": 1},
        {"path": "/dns/{domain}", "payer": "0xs", "count": 1},
        # same-route repeater
        {"path": "/defi/yields", "payer": "0xr", "count": 3},
    ]
    out = wlr.build_ledger(rows, PRICES, SELF)
    by = {p["payer"]: p for p in out["by_payer"]}
    assert by["0xs"]["catalogue_sweep"] is True
    assert by["0xr"]["catalogue_sweep"] is False
    assert out["payers_same_route_repeat"] == 1
    yields = next(r for r in out["by_route"] if r["path"] == "/defi/yields")
    assert yields["distinct_payers"] == 2 and yields["same_route_repeat_payers"] == 1


def test_unpriced_route_counted_but_not_invented():
    rows = [{"path": "/mystery", "payer": "0xz", "count": 5}]
    out = wlr.build_ledger(rows, PRICES, SELF)
    assert out["unpriced_routes"] == {"/mystery": 5}
    assert out["ledger_usdc"] == 0.0 and out["external_calls"] == 5


def _fetcher(paid, metrics_calls=7):
    def fetch(url, timeout=35):
        if url.endswith("/.well-known/x402"):
            return {"resources": [{"resource": "https://x.example/defi/yields", "price_usdc": "0.001"}]}
        if "/internal/traffic-stats" in url:
            return {"ok": True, "paid": paid}
        if url.endswith("/metrics"):
            return {"net_external": {"external_calls": metrics_calls}}
        raise AssertionError(url)
    return fetch


def test_run_produces_contract_fields(tmp_path):
    chain = tmp_path / "latest.json"
    chain.write_text(json.dumps({"total_external_usdc": 0.887}))
    out = wlr.run(hours=720, base="https://x.example", secret_fn=lambda: "s",
                  fetch=_fetcher([{"path": "/defi/yields", "payer": "0xb1", "count": 7}]),
                  chain_path=str(chain), now=1_800_000_000)
    assert out["window_start_ts"] == 1_800_000_000 - 720 * 3600 > 0
    assert out["external_calls"] == 7 and out["ledger_usdc"] == pytest.approx(0.007)
    assert out["ledger_vs_metrics_call_delta"] == 0
    assert out["revenue_ledger_plus_chain_usdc"] == pytest.approx(0.894)
    assert "secret" not in json.dumps(out).lower().replace("traffic_stats_secret", "")


def test_missing_secret_fails_loudly():
    with pytest.raises(RuntimeError, match="TRAFFIC_STATS_SECRET"):
        wlr.run(secret_fn=lambda: "", fetch=_fetcher([]))


def test_empty_manifest_fails_loudly():
    def fetch(url, timeout=35):
        return {"resources": []}
    with pytest.raises(RuntimeError, match="zero priced routes"):
        wlr.run(secret_fn=lambda: "s", fetch=fetch)


def test_missing_chain_file_degrades_open(tmp_path):
    out = wlr.run(secret_fn=lambda: "s", fetch=_fetcher([]), chain_path=str(tmp_path / "nope.json"))
    assert out["onchain_usdc"] is None and out["revenue_ledger_plus_chain_usdc"] is None
