#!/usr/bin/env python3
"""Negative-control tests for the Line-A A0 DATA-route canaries.

A canary that only ever passes is decoration. These prove each predicate TRIPS on
the exact silent-degradation it exists to catch, PASSES on real healthy data, and
DEGRADES OPEN (None) on a missing payload — never a false alarm.
Run: python3 tests/test_canary_predicates.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
from canary_predicates import yields_ok, funding_ok, prices_ok  # noqa: E402

checks = []


def expect(name, got, want):
    ok = got == want
    checks.append((name, ok, got, want))
    print(("PASS" if ok else "FAIL") + f"  {name}  got={got} want={want}")


# ---- /defi/yields ----
GOOD_YIELDS = {"preview": [{"apy": 2.25, "tvlUsd": 2.2e10}], "total_available": 20}
expect("yields: healthy -> True", yields_ok(GOOD_YIELDS)[0], True)
# the silent-degradation footgun: upstream break / resolver bug returns empty 200
expect("yields: empty preview -> False", yields_ok({"preview": [], "total_available": 0})[0], False)
# field regression nulls the numbers
expect("yields: null apy -> False", yields_ok({"preview": [{"apy": None, "tvlUsd": 1e9}], "total_available": 5})[0], False)
expect("yields: zero tvl -> False", yields_ok({"preview": [{"apy": 3.0, "tvlUsd": 0}], "total_available": 5})[0], False)
# nonsense apy (decimals bug) out of band
expect("yields: apy out of band -> False", yields_ok({"preview": [{"apy": 1e9, "tvlUsd": 1e9}], "total_available": 5})[0], False)
# bool is not a valid number (isinstance(True, int) footgun)
expect("yields: bool apy -> False", yields_ok({"preview": [{"apy": True, "tvlUsd": 1e9}], "total_available": 5})[0], False)
# degrade open
expect("yields: no payload -> None", yields_ok(None)[0], None)

# ---- /crypto/funding ----
GOOD_FUNDING = {"preview": [{"funding": {"hyperliquid": 1.25e-5, "okx": 6.2e-5, "dydx": 0, "binance": 1.5e-5, "bybit": 2.9e-5}, "markPx": 79977}]}
expect("funding: healthy 5 venues -> True", funding_ok(GOOD_FUNDING)[0], True)
# dydx=0 is a VALID funding rate, not a failure
expect("funding: dydx zero is fine -> True", funding_ok(GOOD_FUNDING)[0], True)
# THE regression we fixed: Binance+Bybit geo-blocked to null (CoinGecko/direct-host 403)
BRIDGE_DEAD = {"preview": [{"funding": {"hyperliquid": 1.25e-5, "okx": 6.2e-5, "dydx": 0, "binance": None, "bybit": None}, "markPx": 79977}]}
expect("funding: binance+bybit null -> False", funding_ok(BRIDGE_DEAD)[0], False)
# a single transient miss is tolerated (>=4 of 5)
ONE_MISS = {"preview": [{"funding": {"hyperliquid": 1.25e-5, "okx": 6.2e-5, "dydx": 0, "binance": 1.5e-5, "bybit": None}, "markPx": 79977}]}
expect("funding: one venue miss tolerated -> True", funding_ok(ONE_MISS)[0], True)
# missing a venue key entirely (schema regression)
MISSING_KEY = {"preview": [{"funding": {"hyperliquid": 1.25e-5, "okx": 6.2e-5, "dydx": 0, "binance": 1.5e-5}, "markPx": 79977}]}
expect("funding: missing venue key -> False", funding_ok(MISSING_KEY)[0], False)
# Hyperliquid bridge dead -> no markPx
expect("funding: null markPx -> False", funding_ok({"preview": [{"funding": GOOD_FUNDING["preview"][0]["funding"], "markPx": None}]})[0], False)
# empty preview
expect("funding: empty preview -> False", funding_ok({"preview": []})[0], False)
# degrade open
expect("funding: no payload -> None", funding_ok(None)[0], None)

# ---- /crypto/prices ----
GOOD_PRICES = {"preview": [{"id": "bitcoin", "symbol": "BTC", "price": 80329.95, "change_24h": 2.9, "confidence": 0.999, "timestamp": 1793830206}]}
expect("prices: healthy BTC -> True", prices_ok(GOOD_PRICES)[0], True)
# negative change_24h is valid (a down day), not a failure
DOWN_DAY = {"preview": [{"id": "bitcoin", "symbol": "BTC", "price": 61000.0, "change_24h": -7.4, "confidence": 0.98, "timestamp": 1793830206}]}
expect("prices: down day is fine -> True", prices_ok(DOWN_DAY)[0], True)
# THE footgun: CoinGecko 403 geo-block/UA regression -> empty preview with a 200
expect("prices: empty preview -> False", prices_ok({"preview": []})[0], False)
# null price (hollow upstream)
expect("prices: null price -> False", prices_ok({"preview": [{"id": "bitcoin", "symbol": "BTC", "price": None, "change_24h": 1.0, "confidence": 0.99, "timestamp": 1793830206}]})[0], False)
# decimals-inflation bug (x1e6) blows past the $10M ceiling
expect("prices: decimals inflation -> False", prices_ok({"preview": [{"id": "bitcoin", "symbol": "BTC", "price": 8.03e10, "change_24h": 1.0, "confidence": 0.99, "timestamp": 1793830206}]})[0], False)
# wrong coin returned (resolver regression) — default preview must be bitcoin
expect("prices: wrong coin -> False", prices_ok({"preview": [{"id": "dogecoin", "symbol": "DOGE", "price": 0.12, "change_24h": 1.0, "confidence": 0.99, "timestamp": 1793830206}]})[0], False)
# bool price (isinstance(True, int) footgun)
expect("prices: bool price -> False", prices_ok({"preview": [{"id": "bitcoin", "symbol": "BTC", "price": True, "change_24h": 1.0, "confidence": 0.99, "timestamp": 1793830206}]})[0], False)
# confidence out of (0,1] band (garbage)
expect("prices: bad confidence -> False", prices_ok({"preview": [{"id": "bitcoin", "symbol": "BTC", "price": 80000.0, "change_24h": 1.0, "confidence": 1.5, "timestamp": 1793830206}]})[0], False)
# missing timestamp (schema regression)
expect("prices: null timestamp -> False", prices_ok({"preview": [{"id": "bitcoin", "symbol": "BTC", "price": 80000.0, "change_24h": 1.0, "confidence": 0.99, "timestamp": None}]})[0], False)
# degrade open
expect("prices: no payload -> None", prices_ok(None)[0], None)

failed = [c for c in checks if not c[1]]
print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
sys.exit(1 if failed else 0)
