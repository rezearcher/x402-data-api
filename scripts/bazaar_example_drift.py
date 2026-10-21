#!/usr/bin/env python3
"""Bazaar output-example drift sensor.

The x402 402-challenge body advertises, per route, a Bazaar `output.example`.
Automated buyers (e.g. agentpay's verified_route prober) and buyer conformance
validators compare a route's LIVE response against that advertised example /
schema. If the example drifts from the real output shape, we look non-conforming
and get skipped or down-ranked -> lost revenue.

This sensor decodes the advertised example from the live 402 challenge and
compares its top-level + nested key sets against the live free-preview response.
It prints any route whose advertised example is missing keys the live output
returns (or vice-versa). Exit 1 if any drift, 0 if clean. No hardcoded expected
shape — both sides are derived at runtime from the live API, so it can't rot.

Usage:  python3 -I scripts/bazaar_example_drift.py [BASE_URL]
"""
import base64
import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://x402-data-api.sigrunner.workers.dev"

# Flagship paid routes + a preview-capable probe URL (token param is the only required input).
ROUTES = [
    ("GET /chain/token-report", "/chain/token-report?token=usdc", "/chain/token-report/preview?token=usdc"),
    ("GET /gate/swap", "/gate/swap?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&side=buy&notional_usd=500",
     "/gate/swap/preview?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&side=buy&notional_usd=500"),
    ("GET /chain/token-security", "/chain/token-security?token=usdc", "/chain/token-security/preview?token=usdc"),
]


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bazaar-drift-sensor/1.0"})
    return urllib.request.urlopen(req, timeout=25)


def advertised_example(challenge_path):
    """Decode Bazaar output.example from the 402 challenge header."""
    try:
        _get(BASE + challenge_path)
        return None  # no 402 = not gated, skip
    except urllib.error.HTTPError as e:
        if e.code != 402:
            return None
        ch = json.loads(base64.b64decode(e.headers.get("payment-required")))
        return ch.get("extensions", {}).get("bazaar", {}).get("info", {}).get("output", {}).get("example")


def live_output(preview_path):
    with _get(BASE + preview_path) as r:
        return json.loads(r.read())


def key_paths(obj, prefix=""):
    """Flatten dict key paths (objects only; lists/scalars are leaves)."""
    out = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else k
            out.add(p)
            out |= key_paths(v, p)
    return out


def main():
    any_drift = False
    for name, chal, prev in ROUTES:
        adv = advertised_example(chal)
        if adv is None:
            print(f"[skip] {name}: no advertised Bazaar example in 402 challenge")
            continue
        try:
            live = live_output(prev)
        except Exception as e:  # noqa: BLE001
            print(f"[warn] {name}: could not fetch live preview ({e})")
            continue
        # The advertised example is the PAID output shape. The free preview deliberately
        # appends CTA-only markers that never appear in paid output: `note` (disclaimer)
        # and the whole `upgrade.*` subtree (the pay-to-upgrade CTA, src/index.ts upgradeCTA).
        # Drop those preview-only keys from the live side so we only flag genuine schema drift.
        PREVIEW_ONLY = {"note", "upgrade"}
        def _strip(keys):
            return {p for p in keys if p.split(".", 1)[0] not in PREVIEW_ONLY}
        adv_keys = _strip(key_paths(adv))
        live_keys = _strip(key_paths(live))
        missing_in_adv = sorted(live_keys - adv_keys)
        extra_in_adv = sorted(adv_keys - live_keys)
        if missing_in_adv or extra_in_adv:
            any_drift = True
            print(f"[DRIFT] {name}")
            if missing_in_adv:
                print(f"   advertised example MISSING live keys: {missing_in_adv}")
            if extra_in_adv:
                print(f"   advertised example has keys NOT in live: {extra_in_adv}")
        else:
            print(f"[ok]   {name}: advertised example matches live output shape ({len(live_keys)} keys)")
    return 1 if any_drift else 0


if __name__ == "__main__":
    sys.exit(main())
