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


def pm_markets_ok(payload):
    """/pm/markets preview — a paid DATA route with real external payers (CDP Bazaar
    demand sensor: /pm/markets, distinct payers in the 30d window).

    Silent-degradation guard: /pm/markets is Polymarket Gamma-API-backed, the SAME
    upstream class as prices/funding whose outage/geo-block/schema-drift returns an
    empty list or null fields with a 200 — a paying agent then gets a hollow market
    list (no prices, no clobTokenIds to trade on) and churns, and availability alone
    (HTTP 200) never catches it. A second, distinct footgun on THIS route is a
    normalization bug: Gamma can hand back outcomePrices as cents/strings, so a 0.951
    probability silently becomes 95.1 — the number is present, non-null, and wrong.

    The preview top-1 is ranked by volume24hr, so its CONTENT is not deterministic
    (which market is #1 changes). Anchor on the structurally-stable *tradeable
    envelope* every real Gamma market carries, never a specific question:
      - a non-empty preview and total_available >= 1 (catches the empty-200 outage);
      - question: a non-empty string;
      - outcomes: a list of >= 2 non-empty strings (binary at minimum);
      - outcomePrices: a list the same length as outcomes, each a number in [0,1]
        (catches null prices AND the cents/decimals normalization bug), and — only
        when the market is binary (2 outcomes), the stable invariant — summing to
        ~1 (band 0.80..1.25, wide enough that book skew never flaps it, tight enough
        to catch a 95.1-style inflation); multi-outcome markets skip the sum check so
        they never false-alarm;
      - volume24hr and liquidity: numbers >= 0 (volume24hr is the ranking key — null
        there means the ranking collapsed);
      - active is True (the preview advertises active markets);
      - conditionId: a 0x-prefixed string and clobTokenIds: a non-empty list (without
        these the row is not tradeable — i.e. a hollow answer on a paid route).
    Degrade open on a missing payload.
    """
    if not isinstance(payload, dict):
        return None, "no payload"

    def numeric(x):
        return isinstance(x, (int, float)) and not isinstance(x, bool)
    pv = payload.get("preview") or []
    top = pv[0] if pv else {}
    q = top.get("question")
    outs = top.get("outcomes") if isinstance(top.get("outcomes"), list) else []
    prices = top.get("outcomePrices") if isinstance(top.get("outcomePrices"), list) else []
    vol24 = top.get("volume24hr")
    liq = top.get("liquidity")
    cond = top.get("conditionId")
    clob = top.get("clobTokenIds") if isinstance(top.get("clobTokenIds"), list) else []

    outs_ok = len(outs) >= 2 and all(isinstance(o, str) and o.strip() for o in outs)
    prices_ok_each = (len(prices) == len(outs) and len(prices) >= 2
                      and all(numeric(p) and 0 <= p <= 1 for p in prices))
    binary_sum_ok = True
    if prices_ok_each and len(prices) == 2:
        binary_sum_ok = 0.80 <= (prices[0] + prices[1]) <= 1.25

    ok = bool(
        len(pv) >= 1 and int(payload.get("total_available") or 0) >= 1
        and isinstance(q, str) and q.strip()
        and outs_ok and prices_ok_each and binary_sum_ok
        and numeric(vol24) and vol24 >= 0
        and numeric(liq) and liq >= 0
        and top.get("active") is True
        and isinstance(cond, str) and cond.startswith("0x") and len(cond) >= 10
        and len(clob) >= 1)
    if ok:
        return True, "ok"
    _psum = round(sum(p for p in prices if numeric(p)), 4) if prices else None
    return False, (f"preview_len={len(pv)} total_available={payload.get('total_available')} "
                   f"question={'set' if (isinstance(q, str) and q.strip()) else q!r} "
                   f"outcomes={len(outs)} prices={prices!r} prices_sum={_psum} "
                   f"volume24hr={vol24} liquidity={liq} active={top.get('active')} "
                   f"conditionId={'set' if (isinstance(cond, str) and cond.startswith('0x')) else cond!r} "
                   f"clobTokenIds={len(clob)} (empty/null Polymarket Gamma upstream — the "
                   f"outage/geo-block hollow-200 footgun — or an outcomePrices cents/decimals "
                   f"normalization bug; a paid DATA route returning an untradeable market)")
