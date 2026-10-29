#!/usr/bin/env python3
"""Pure correctness predicates for the Line-A A0 DATA-route canaries (no network).

Kept separate from uptime_probe.py so the assertion logic can be unit-tested with
negative controls — a canary is only worth anything if it is proven to TRIP on the
exact silent-degradation it guards. Each predicate returns (ok, reason):
  ok=True   -> data is real and in-band
  ok=False  -> a regression is detected (reason names it, for the alert)
  ok=None   -> inconclusive / degrade-open (missing payload; never a false alarm)
"""

VENUES = ("hyperliquid", "okx", "dydx", "binance", "bybit")


def yields_ok(payload):
    """/defi/yields preview — the #1 external-payer DATA route.

    Silent-degradation guard: a DefiLlama upstream break or a filter-resolver bug
    returns an empty preview / null fields with a 200, handing a paying agent a
    hollow answer. Assert a non-empty preview, a numeric apy in [0,100000)%, a
    positive tvlUsd, and total_available>=1. Degrade open on a missing payload.
    """
    if not isinstance(payload, dict):
        return None, "no payload"
    pv = payload.get("preview") or []
    top = pv[0] if pv else {}
    apy, tvl = top.get("apy"), top.get("tvlUsd")
    ok = bool(
        len(pv) >= 1 and int(payload.get("total_available") or 0) >= 1
        and isinstance(apy, (int, float)) and not isinstance(apy, bool) and 0 <= apy < 100000
        and isinstance(tvl, (int, float)) and not isinstance(tvl, bool) and tvl > 0)
    if ok:
        return True, "ok"
    return False, (f"preview_len={len(pv)} total_available={payload.get('total_available')} "
                   f"top_apy={apy} top_tvlUsd={tvl} (empty/null DefiLlama upstream or resolver bug "
                   f"— #1 paid route returning a hollow answer)")


def funding_ok(payload):
    """/crypto/funding preview — the 5-venue superset.

    Silent-degradation guard: the exact bug we fixed was Binance+Bybit geo-blocked
    to null while returning 200. Assert a non-empty preview, all 5 venue keys
    present, >=4 of 5 non-null (tolerates one transient upstream miss), NOT the
    both-null Binance+Bybit signature, and a positive numeric markPx (the
    Hyperliquid bridge is alive). 0 is a valid funding rate — only None is failure.
    Degrade open on a missing payload.
    """
    if not isinstance(payload, dict):
        return None, "no payload"
    fpv = payload.get("preview") or []
    f0 = (fpv[0] if fpv else {}).get("funding") or {}
    present = all(v in f0 for v in VENUES)
    non_null = sum(1 for v in VENUES if f0.get(v) is not None)
    bridge_dead = f0.get("binance") is None and f0.get("bybit") is None
    mark = (fpv[0] if fpv else {}).get("markPx")
    ok = bool(
        len(fpv) >= 1 and present and non_null >= 4 and not bridge_dead
        and isinstance(mark, (int, float)) and not isinstance(mark, bool) and mark > 0)
    if ok:
        return True, "ok"
    return False, (f"preview_len={len(fpv)} non_null_venues={non_null}/5 "
                   f"binance={f0.get('binance')} bybit={f0.get('bybit')} markPx={mark} "
                   f"(a venue silently degraded to null — the geo-block/UA footgun; "
                   f"5-venue superset is hollow)")
