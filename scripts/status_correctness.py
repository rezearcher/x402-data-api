#!/usr/bin/env python3
"""Fold the correctness-canary sensor into the public /status snapshot.

HTTP-200 uptime is NOT correctness: a geo-blocked upstream returns an empty/hollow 200 that
an availability probe never sees. scripts/uptime_probe.py runs canaries (each with a proven
negative control in canary_predicates.py) and writes the result to
~/.hermes/data/x402-data-api-uptime/latest.json. This module turns that INTERNAL signal into a
BUYER-FACING trust block on GET /status — the connection competitors (uptime-only status pages)
do not publish. Degrades OPEN: a missing sensor omits the block (backward-compatible); a stale
sensor downgrades every check to 'inconclusive' rather than asserting a possibly-wrong 'passing'.
"""
import datetime
import json
import os

# Route -> (sensor key, honest one-line description of what the canary proves). Measurement,
# not an SLA; 'inconclusive' means the probe could not conclude, never a silent fail.
CORRECTNESS_GUARDS = {
    "/defi/yields": ("yields_detection_ok", "Returns real numeric APY/TVL rows (not an empty 200 from an upstream geo-block)"),
    "/crypto/prices": ("prices_detection_ok", "Returns a live non-null USD price (guards the hollow-200 geo-block footgun)"),
    "/crypto/funding": ("funding_detection_ok", "Multi-venue funding rows stay numeric when a venue geo-blocks to null"),
    "/defi/yield-entry-verdict": ("yield_verdict_detection_ok", "Entry verdict keeps its APY/prediction substance, not a hollow label"),
    "/gate/swap": ("gate_detection_ok", "A structural honeypot still blocks and a known-good token still passes (no false-SAFE)"),
    "/chain/token-report": ("report_detection_ok", "Honeypot screens AVOID, good token screens SAFE, DEX tax reads clean"),
    "/chain/token-security": ("security_detection_ok", "Metadata/sim decode correct on a known-good token (no fabricated risk)"),
    "/scan/mcp": ("scan_detection_ok", "A poisoned MCP canary is still flagged (prompt-injection detection not regressed)"),
}
CORRECTNESS_SENSOR = os.path.expanduser("~/.hermes/data/x402-data-api-uptime/latest.json")
FRESH_WINDOW_S = 7200  # probe runs every 5 min; >2h old = sensor stalled -> do not assert passing


def correctness_block(sensor_path=None, now=None):
    """Return a /status correctness block, or None to omit the block entirely (degrade-open)."""
    path = sensor_path or CORRECTNESS_SENSOR
    try:
        sensor = json.load(open(path))
    except Exception:
        return None
    now = now or datetime.datetime.now(datetime.UTC)
    checked = sensor.get("fetched_at")
    try:
        age = (now - datetime.datetime.fromisoformat(str(checked).replace("Z", "+00:00"))).total_seconds()
        fresh = 0 <= age <= FRESH_WINDOW_S
    except Exception:
        fresh = False
    checks = {}
    for route, (key, desc) in CORRECTNESS_GUARDS.items():
        raw = sensor.get(key)
        if not fresh or raw is None:
            status = "inconclusive"
        else:
            status = "passing" if raw else "regressed"
        checks[route] = {"status": status, "guards": desc}
    concluded = [c["status"] for c in checks.values() if c["status"] != "inconclusive"]
    return {
        "method": "canary probes with proven negative controls (scripts/uptime_probe.py + canary_predicates.py); availability (HTTP 200) is NOT correctness",
        "note": "Point-in-time measurement, not an SLA. 'inconclusive' = the probe could not conclude (degrade-open), not a failure.",
        "last_checked": checked,
        "fresh": fresh,
        "all_passing": bool(concluded) and all(s == "passing" for s in concluded),
        "checks": checks,
    }
