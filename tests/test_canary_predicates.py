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
from canary_predicates import yields_ok, funding_ok, prices_ok, yield_verdict_ok, pm_markets_ok  # noqa: E402

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

# ---- /defi/yield-entry-verdict (the MOAT route) ----
GOOD_VERDICT = {"preview": {"verdict": "SUSTAINABLE", "risk_score": 0, "apy": 2.274,
                            "predicted": {"class": "Stable/Up", "probability": 70}, "tvlUsd": 2.34e10,
                            "reasons": [{"code": "stable_sustainable", "detail": "…", "field": "predicted_class"}]}}
expect("verdict: healthy SUSTAINABLE -> True", yield_verdict_ok(GOOD_VERDICT)[0], True)
# every valid verdict label passes (AVOID is a real, substance-backed decision, not a failure)
AVOID_V = {"preview": {"verdict": "AVOID", "risk_score": 85, "apy": 120.0,
                       "predicted": {"class": "Decay", "probability": 15}, "tvlUsd": 4.1e6,
                       "reasons": [{"code": "outlier_apy", "detail": "…", "field": "apy"}]}}
expect("verdict: AVOID is a valid decision -> True", yield_verdict_ok(AVOID_V)[0], True)
# THE regression: DefiLlama/prediction upstream nulls -> label survives but apy/predicted/reasons collapse
HOLLOW = {"preview": {"verdict": "SUSTAINABLE", "risk_score": 0, "apy": None,
                      "predicted": {}, "tvlUsd": 2.34e10, "reasons": []}}
expect("verdict: hollow (null apy, empty reasons) -> False", yield_verdict_ok(HOLLOW)[0], False)
# garbage verdict label (resolver regression)
expect("verdict: bad label -> False", yield_verdict_ok({"preview": {**GOOD_VERDICT["preview"], "verdict": "MAYBE"}})[0], False)
# field-citation moat lost: reasons present but missing the `field` cite
NO_FIELD = {"preview": {**GOOD_VERDICT["preview"], "reasons": [{"code": "x", "detail": "y"}]}}
expect("verdict: reasons missing field cite -> False", yield_verdict_ok(NO_FIELD)[0], False)
# predicted probability out of band (garbage)
expect("verdict: prob out of band -> False", yield_verdict_ok({"preview": {**GOOD_VERDICT["preview"], "predicted": {"class": "Up", "probability": 150}}})[0], False)
# zero tvl (hollow pool)
expect("verdict: zero tvl -> False", yield_verdict_ok({"preview": {**GOOD_VERDICT["preview"], "tvlUsd": 0}})[0], False)
# bool risk_score (isinstance(True,int) footgun)
expect("verdict: bool risk_score -> False", yield_verdict_ok({"preview": {**GOOD_VERDICT["preview"], "risk_score": True}})[0], False)
# preview is a list (wrong shape — the yields route returns a list; this route an object)
expect("verdict: list preview -> None", yield_verdict_ok({"preview": []})[0], None)
# degrade open
expect("verdict: no payload -> None", yield_verdict_ok(None)[0], None)

# ---- /pm/markets (paid DATA route, real external payers) ----
# Fixture mirrors a live Polymarket Gamma preview row (binary market).
GOOD_PM = {"preview": [{
    "question": "Will Mary Peltola win the Alaska Senate race in 2026?",
    "slug": "will-mary-peltola-win", "outcomes": ["Yes", "No"],
    "outcomePrices": [0.951, 0.049], "volume": 3702541.8, "volume24hr": 780815.9,
    "volume1wk": 2542407.3, "liquidity": 225458.2, "endDate": "2026-11-04T04:59:00Z",
    "active": True, "bestBid": 0.95, "bestAsk": 0.952, "spread": 0.002,
    "clobTokenIds": ["72139607190315861034411702195742538105117960260100800877125381826122747504258",
                     "38274379050640062523611849065721372699838119672720475300345842413156391540232"],
    "conditionId": "0x19d2ff72e389d190c183e6b114817301d29eba651d67d75a38ee201a05188fd9",
}], "total_available": 20}
expect("pm: healthy binary market -> True", pm_markets_ok(GOOD_PM)[0], True)
# multi-outcome market (3 legs) — per-price band holds, binary-sum check is skipped so no false alarm
MULTI_PM = {"preview": [{**GOOD_PM["preview"][0], "outcomes": ["A", "B", "C"],
                         "outcomePrices": [0.5, 0.3, 0.2]}], "total_available": 12}
expect("pm: multi-outcome (sum check skipped) -> True", pm_markets_ok(MULTI_PM)[0], True)
# THE primary regression: Gamma upstream empties with a 200 (hollow)
expect("pm: empty preview (upstream outage) -> False", pm_markets_ok({"preview": [], "total_available": 0})[0], False)
# cents/decimals normalization bug: 0.951 silently becomes 95.1 (present, non-null, WRONG)
CENTS_PM = {"preview": [{**GOOD_PM["preview"][0], "outcomePrices": [95.1, 4.9]}], "total_available": 20}
expect("pm: cents-normalization bug (prices>1) -> False", pm_markets_ok(CENTS_PM)[0], False)
# null outcomePrices (schema regression)
NULLP_PM = {"preview": [{**GOOD_PM["preview"][0], "outcomePrices": [None, None]}], "total_available": 20}
expect("pm: null outcomePrices -> False", pm_markets_ok(NULLP_PM)[0], False)
# binary prices present and in-band but wildly off-sum (book/resolver bug -> 0.9+0.9=1.8)
BADSUM_PM = {"preview": [{**GOOD_PM["preview"][0], "outcomePrices": [0.9, 0.9]}], "total_available": 20}
expect("pm: binary prices out-of-sum -> False", pm_markets_ok(BADSUM_PM)[0], False)
# ranking key null (volume24hr) — the order collapsed
expect("pm: null volume24hr -> False", pm_markets_ok({"preview": [{**GOOD_PM["preview"][0], "volume24hr": None}], "total_available": 20})[0], False)
# empty clobTokenIds — market not tradeable (hollow)
expect("pm: no clobTokenIds -> False", pm_markets_ok({"preview": [{**GOOD_PM["preview"][0], "clobTokenIds": []}], "total_available": 20})[0], False)
# missing/short conditionId
expect("pm: bad conditionId -> False", pm_markets_ok({"preview": [{**GOOD_PM["preview"][0], "conditionId": None}], "total_available": 20})[0], False)
# inactive market leaked into an "active" preview (filter regression)
expect("pm: inactive market -> False", pm_markets_ok({"preview": [{**GOOD_PM["preview"][0], "active": False}], "total_available": 20})[0], False)
# single-outcome / malformed outcomes
expect("pm: <2 outcomes -> False", pm_markets_ok({"preview": [{**GOOD_PM["preview"][0], "outcomes": ["Yes"], "outcomePrices": [1.0]}], "total_available": 20})[0], False)
# bool volume24hr (isinstance(True,int) footgun)
expect("pm: bool volume24hr -> False", pm_markets_ok({"preview": [{**GOOD_PM["preview"][0], "volume24hr": True}], "total_available": 20})[0], False)
# degrade open
expect("pm: no payload -> None", pm_markets_ok(None)[0], None)

failed = [c for c in checks if not c[1]]
print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
sys.exit(1 if failed else 0)
