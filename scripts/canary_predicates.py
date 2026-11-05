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


def prices_ok(payload):
    """/crypto/prices preview — the #2 external-payer DATA route (9 recurring payers).

    Silent-degradation guard: /crypto/prices is CoinGecko-backed, the same upstream
    class whose geo-block/UA regression (403) returns an empty list / null fields with
    a 200 — a paying agent then gets a hollow price and churns, and availability alone
    never catches it. The free preview's default coin is DETERMINISTIC bitcoin/BTC
    (confirmed live 2026-11-04 across both hosts), so anchor on that structurally-stable
    fixture: a non-empty preview whose top item is id=bitcoin / symbol=BTC with a
    numeric price in a permanent band (>$1k floor BTC has held for years; <$10M ceiling
    catches a 1e6/1e18 decimals-inflation bug), a numeric change_24h, a confidence in
    (0,1], and a positive int timestamp. Bands are wide enough that live market drift
    cannot flap them, tight enough to catch null / empty / a decimals bug. Degrade open
    on a missing payload.
    """
    if not isinstance(payload, dict):
        return None, "no payload"
    pv = payload.get("preview") or []
    top = pv[0] if pv else {}
    price = top.get("price")
    chg = top.get("change_24h")
    conf = top.get("confidence")
    ts = top.get("timestamp")

    def numeric(x):
        return isinstance(x, (int, float)) and not isinstance(x, bool)
    ok = bool(
        len(pv) >= 1
        and top.get("id") == "bitcoin" and top.get("symbol") == "BTC"
        and numeric(price) and 1000 < price < 10_000_000
        and numeric(chg)
        and numeric(conf) and 0 < conf <= 1
        and isinstance(ts, int) and not isinstance(ts, bool) and ts > 0)
    if ok:
        return True, "ok"
    return False, (f"preview_len={len(pv)} top_id={top.get('id')} top_symbol={top.get('symbol')} "
                   f"price={price} change_24h={chg} confidence={conf} timestamp={ts} "
                   f"(empty/null CoinGecko upstream — the geo-block/UA 403 footgun — or a "
                   f"decimals bug; #2 paid route returning a hollow price)")


VERDICTS = ("SUSTAINABLE", "DECAYING", "OUTLIER", "AVOID")


def yield_verdict_ok(payload):
    """/defi/yield-entry-verdict preview — our #1 MOAT route (the only entry DECISION;
    named rivals charge 5x for raw pools and return no go/no-go — ClawMerchants intel).

    Silent-degradation guard: the verdict is computed from DefiLlama /pools PLUS the
    /chart prediction endpoint. If either upstream goes null/empty with a 200, the
    decision layer collapses hollow — the verdict label survives but apy goes null,
    the predicted class/probability drops, and the field-cited reasons array empties.
    A paying agent then gets a confident-looking label with no substance behind it and
    makes a real capital decision on it — the worst failure on the lane that converts.
    Availability alone never sees it. The free preview anchors on the current top-TVL
    pool (large, structurally stable), so assert the decision envelope, not a specific
    pool: a dict preview whose verdict is one of the 4 valid labels, risk_score in
    [0,100], a numeric apy in [0,100000)%, a predicted {class:non-empty-str,
    probability:[0,100]}, a positive tvlUsd, and a non-empty reasons[] whose first
    entry carries both a `code` and a `field` (the field-citation moat — reasons going
    empty IS the decision-layer regression). Degrade open on a missing payload.
    """
    if not isinstance(payload, dict):
        return None, "no payload"
    pv = payload.get("preview")
    if not isinstance(pv, dict) or not pv:
        return None, "no preview object"

    def numeric(x):
        return isinstance(x, (int, float)) and not isinstance(x, bool)
    verdict = pv.get("verdict")
    risk = pv.get("risk_score")
    apy = pv.get("apy")
    pred = pv.get("predicted") if isinstance(pv.get("predicted"), dict) else {}
    pcls = pred.get("class")
    pprob = pred.get("probability")
    tvl = pv.get("tvlUsd")
    reasons = pv.get("reasons") if isinstance(pv.get("reasons"), list) else []
    r0 = reasons[0] if reasons and isinstance(reasons[0], dict) else {}
    ok = bool(
        verdict in VERDICTS
        and numeric(risk) and 0 <= risk <= 100
        and numeric(apy) and 0 <= apy < 100000
        and isinstance(pcls, str) and pcls.strip()
        and numeric(pprob) and 0 <= pprob <= 100
        and numeric(tvl) and tvl > 0
        and len(reasons) >= 1 and bool(r0.get("code")) and bool(r0.get("field")))
    if ok:
        return True, "ok"
    return False, (f"verdict={verdict} risk_score={risk} apy={apy} predicted_class={pcls} "
                   f"predicted_prob={pprob} tvlUsd={tvl} reasons={len(reasons)} "
                   f"r0_code={r0.get('code')} r0_field={r0.get('field')} "
                   f"(null DefiLlama/prediction upstream or a resolver bug — the MOAT "
                   f"entry-decision route returning a hollow verdict)")
