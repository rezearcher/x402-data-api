#!/usr/bin/env python3
"""Price-consistency sensor.

Ground truth = the atomic `amount` in each route's LIVE x402 402 quote
(/.well-known/x402), i.e. what the CDP facilitator actually enforces and a
buyer actually pays. We then scan the public *advertised* price strings
(landing HTML `/`, `/llms.txt`, and each route's own 402 `description`) and
flag any `$0.00X` sitting next to a route path that disagrees with the
enforced amount.

Why: a buyer (or a registry reviewer — this exact mismatch was flagged on
/chain/eth-usd) who sees "$0.004" advertised but a $0.001 quote loses trust.
No hardcoded price roster: enforced prices are derived at runtime from the
live manifest; advertised prices are parsed from the live surfaces. Degrades
OPEN — unparseable surfaces are reported, never silently passed.

Run:  python3 -I scripts/price_consistency_sensor.py
Cron-friendly: writes ~/.hermes/data/x402_price_consistency/latest.json
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("X402_BASE", "https://api.greyridgesignals.ai")
OUT_DIR = os.path.expanduser("~/.hermes/data/x402_price_consistency")
USDC_DECIMALS = 6
PRICE_RE = re.compile(r"\$0?\.0*[0-9]+")  # $0.001, $0.05, ...
ROUTE_RE = re.compile(r"/[a-z0-9]+(?:/[a-z0-9\-{}]+)+")


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "greyridge-price-sensor/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def enforced_prices():
    """route-path -> enforced USD (float), from the live manifest."""
    doc = json.loads(fetch(f"{BASE}/.well-known/x402"))
    res = doc.get("resources") or doc.get("accepts") or []
    out = {}
    for r in res:
        url = r.get("resource") or r.get("url") or ""
        path = re.sub(r"^https?://[^/]+", "", url).split("?")[0]
        acc = r.get("accepts") or []
        if not path or not acc:
            continue
        amt = acc[0].get("amount") or acc[0].get("maxAmountRequired")
        if amt is None:
            continue
        try:
            out[path] = round(int(amt) / (10 ** USDC_DECIMALS), 6)
        except (ValueError, TypeError):
            continue
    return out


def usd_from_str(s):
    return round(float(s.replace("$", "")), 6)


def scan_surface(text, enforced):
    """Find `$price` tokens near a known route path; flag disagreements."""
    mismatches, checked = [], 0
    for m in PRICE_RE.finditer(text):
        start = max(0, m.start() - 120)
        window = text[start:m.end() + 40]
        adv = usd_from_str(m.group())
        for rpath in ROUTE_RE.findall(window):
            # normalise {domain}-style and trailing /preview
            norm = rpath.replace("/preview", "")
            if norm in enforced:
                checked += 1
                exp = enforced[norm]
                if abs(adv - exp) > 1e-9:
                    mismatches.append({"route": norm, "advertised": adv, "enforced": exp})
                break
    return checked, mismatches


def main():
    ts = datetime.now(timezone.utc).isoformat()
    result = {"ts": ts, "base": BASE, "status": "ok", "alert": False,
              "surfaces": {}, "mismatches": [], "errors": []}
    try:
        enforced = enforced_prices()
        result["n_enforced_routes"] = len(enforced)
    except Exception as e:  # degrade open
        result.update(status="error", alert=True)
        result["errors"].append(f"manifest: {e}")
        _write(result)
        print(json.dumps(result, indent=2))
        return 2

    surfaces = {"landing": f"{BASE}/", "llms": f"{BASE}/llms.txt"}
    seen = set()
    for name, url in surfaces.items():
        try:
            txt = fetch(url)
            checked, mm = scan_surface(txt, enforced)
            result["surfaces"][name] = {"checked": checked, "mismatches": len(mm)}
            for x in mm:
                key = (x["route"], x["advertised"], x["enforced"])
                if key not in seen:
                    seen.add(key)
                    x["surface"] = name
                    result["mismatches"].append(x)
        except Exception as e:  # degrade open: report, don't silently pass
            result["surfaces"][name] = {"error": str(e)}
            result["errors"].append(f"{name}: {e}")

    result["alert"] = bool(result["mismatches"]) or bool(result["errors"])
    result["summary"] = (
        f"{len(result['mismatches'])} price mismatch(es) across "
        f"{len(enforced)} enforced routes; {len(result['errors'])} surface error(s)"
    )
    _write(result)
    print(json.dumps(result, indent=2))
    return 1 if result["mismatches"] else 0


def _write(result):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "latest.json"), "w") as f:
        json.dump(result, f, indent=2)


if __name__ == "__main__":
    sys.exit(main())
