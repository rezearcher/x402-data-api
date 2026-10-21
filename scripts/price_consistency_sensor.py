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
import urllib.error
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


def fetch_mcp_tools(timeout=25):
    """POST tools/list to /mcp, parse the (possibly SSE-framed) JSON-RPC reply."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}).encode()
    req = urllib.request.Request(
        f"{BASE}/mcp", data=body, method="POST",
        headers={"User-Agent": "greyridge-price-sensor/1", "Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8", "replace")
    for line in raw.splitlines():
        line = line[5:].strip() if line.startswith("data:") else line.strip()
        if not line.startswith("{"):
            continue
        try:
            doc = json.loads(line)
        except ValueError:
            continue
        tools = (doc.get("result") or {}).get("tools")
        if tools is not None:
            return tools
    raise ValueError("no tools/list payload in /mcp response")


def mcp_flat_price():
    """The MCP surface charges a FLAT price per tools/call regardless of the
    underlying HTTP route (confirmed live: every tools/call 402 quotes the same
    amount). Derive it at runtime from a real tools/call 402 so nothing is
    hardcoded. Returns USD float, or None if it can't be probed."""
    body = json.dumps({"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                       "params": {"name": "crypto_prices", "arguments": {}}}).encode()
    req = urllib.request.Request(
        f"{BASE}/mcp", data=body, method="POST",
        headers={"User-Agent": "greyridge-price-sensor/1", "Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        # The unpaid tools/call returns HTTP 402 with the price in its body —
        # that IS the signal we want, not a failure.
        raw = e.read().decode("utf-8", "replace")
    except Exception:
        return None
    m = re.search(r'"(?:amount|maxAmountRequired)"\s*:\s*"?(\d+)"?', raw)
    return round(int(m.group(1)) / (10 ** USDC_DECIMALS), 6) if m else None


def scan_mcp(tools, mcp_price):
    """On the MCP surface every paid tools/call costs the same flat `mcp_price`.
    A tool description is correct iff it quotes that price somewhere (it MAY also
    mention the higher direct-HTTP price, e.g. '$0.005 via MCP ... HTTP is $0.01'
    — that dual form is fine). We flag a paid tool only when it quotes a price
    but NEVER the real MCP price, i.e. it would misquote what a tools/call
    actually charges. Free *_preview tools are skipped."""
    mismatches, checked = [], 0
    for t in tools:
        name = t.get("name", "")
        if name.endswith("_preview"):
            continue
        desc = t.get("description", "") or ""
        prices = {usd_from_str(m.group()) for m in PRICE_RE.finditer(desc)}
        if not prices:
            continue
        checked += 1
        if not any(abs(p - mcp_price) <= 1e-9 for p in prices):
            mismatches.append({"tool": name, "advertised": sorted(prices), "enforced": mcp_price})
    return checked, mismatches


def scan_surface(text, enforced):
    """Flag `$price` tokens that disagree with the enforced price of the route
    they belong to.

    A price is associated with the NEAREST route that PRECEDES it within a tight
    window (prices in this API are written after their route: "GET /x — $0.002"
    or "/x</code> ($0.002)"). Picking the nearest-preceding route (not the first
    in a wide window) avoids mis-attributing a price to an earlier route on a
    multi-route line, and skips range cells ("$0.002–$0.005") where the prices
    come before the route list (no preceding route -> not checked).
    """
    mismatches, checked = [], 0
    for m in PRICE_RE.finditer(text):
        # Only look back within the CURRENT line (each route+price pair lives on
        # one line / one table row), so a range cell's price can't bleed onto a
        # route from the previous row.
        line_start = text.rfind("\n", 0, m.start()) + 1
        window = text[max(line_start, m.start() - 160):m.start()]
        routes = list(ROUTE_RE.finditer(window))
        if not routes:
            continue
        norm = routes[-1].group().replace("/preview", "")  # nearest preceding
        if norm not in enforced:
            continue
        checked += 1
        adv = usd_from_str(m.group())
        exp = enforced[norm]
        if abs(adv - exp) > 1e-9:
            mismatches.append({"route": norm, "advertised": adv, "enforced": exp})
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

    # MCP tool-definition descriptions — the surface agent clients actually copy
    # (a stale "$0.01" in gate_swap's tool-def sat here, invisible to the path-
    # keyed landing/llms scans, until caught 2026-10-21).
    try:
        mcp_price = mcp_flat_price()
        if mcp_price is None:
            raise ValueError("could not probe flat tools/call price")
        tools = fetch_mcp_tools()
        checked, mm = scan_mcp(tools, mcp_price)
        result["surfaces"]["mcp"] = {"checked": checked, "mismatches": len(mm), "flat_price": mcp_price}
        for x in mm:
            key = (x["tool"], tuple(x["advertised"]))
            if key not in seen:
                seen.add(key)
                x["surface"] = "mcp"
                result["mismatches"].append(x)
    except Exception as e:  # degrade open
        result["surfaces"]["mcp"] = {"error": str(e)}
        result["errors"].append(f"mcp: {e}")

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
