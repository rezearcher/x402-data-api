#!/usr/bin/env python3
"""Line-B fiat (Stripe) settled-revenue oracle.

Reads the public /metrics `fiat` block (minted by src/usage.ts getFiatMetrics,
fed by the /stripe/webhook settlement recorder) and writes a durable, loop-
readable mirror at ~/.hermes/data/x402-revenue/fiat_latest.json — the Line-B
twin of Line A's latest.json. The money loop / verify_goal reads this to know
whether a real fiat subscription dollar (and the REPEAT dollar = an
invoice.paid renewal) has settled, instead of being structurally blind to every
Stripe payment (which the webhook previously only console.logged, ephemerally).

Claims law (mirrors latest.json): status='ok' ONLY on a clean HTTP 200 + parse
with the fiat block present. Any error -> status='read-failed' and the loop must
NOT treat the zeros as a genuine $0 (a read failure is not a revenue signal).
Never fabricate 'ok'.

Cron (daily, offset from the Line A sensor and uptime probe):
    25 6 * * *  cd <repo> && python3 scripts/fiat_revenue_oracle.py
/metrics is edge-cached up to 1h; a daily poll tolerates that staleness fine.
"""
import json
import os
import urllib.request
import urllib.error
import datetime

METRICS_URL = "https://x402-data-api.sigrunner.workers.dev/metrics"
OUT = os.path.expanduser("~/.hermes/data/x402-revenue/fiat_latest.json")


def _event(block, key):
    e = (block or {}).get(key) or {}
    return {
        "count": int(e.get("count", 0) or 0),
        "gross_usd": float(e.get("gross_usd", 0) or 0.0),
    }


def main() -> int:
    now = datetime.datetime.utcnow().isoformat() + "Z"
    status = "read-failed"
    fiat = {}
    note = ""
    try:
        req = urllib.request.Request(METRICS_URL, headers={"User-Agent": "greyridge-fiat-oracle/1"})
        with urllib.request.urlopen(req, timeout=25) as r:
            code = r.status
            body = json.loads(r.read())
        if code == 200 and isinstance(body.get("fiat"), dict):
            fiat = body["fiat"]
            status = "ok"
        else:
            note = f"http={code} fiat_block_present={isinstance(body.get('fiat'), dict)}"
    except urllib.error.HTTPError as e:
        note = f"HTTPError {e.code}"
    except Exception as e:  # noqa: BLE001 — any failure is a read-failed, never a $0 claim
        note = f"{type(e).__name__}: {e}"

    checkout = _event(fiat, "checkout_paid")
    invoice = _event(fiat, "invoice_paid")
    total = fiat.get("total_gross_usd")
    if status == "ok" and total is None:
        total = round(checkout["gross_usd"] + invoice["gross_usd"], 2)

    out = {
        "fetched_at": now,
        "status": status,  # 'ok' only on a clean read; else 'read-failed'
        "source": METRICS_URL,
        "total_gross_usd": float(total or 0.0) if status == "ok" else 0.0,
        "checkout_paid": checkout,
        "invoice_paid": invoice,
        # The REPEAT dollar = a recurring renewal settled. checkout_paid alone is
        # a one-time signup; a true repeat requires an invoice.paid.
        "repeat_dollar": status == "ok" and invoice["count"] > 0,
        "note": note,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
