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


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The in-repo artifacts a prospect actually copies to wire a PAID call. A stale
# price here ($0.01 in docs/examples/swap-gate/gate.mjs sat invisible to the
# live-surface scans until caught 2026-10-21) misquotes what the 402 enforces at
# the exact moment of integration. Globbed, not a hardcoded file roster.
ARTIFACT_GLOBS = ("docs/examples/**/*.mjs", "examples/**/*.mjs",
                  "examples/**/*.sh", "docs/EXAMPLES.md")
# Full-URL route reference in example code (our two live hostnames). The route
# the file actually CALLS is ground truth for what it costs.
URL_ROUTE_RE = re.compile(
    r"(?:x402-data-api\.sigrunner\.workers\.dev|api\.greyridgesignals\.ai)"
    r"(/[a-z0-9][a-z0-9\-/]*)")
COMMENT_PRICE_RE = re.compile(r"^\s*(?://|#).*?(\$0?\.0*[0-9]+)", re.M)


def _iter_artifact_files():
    import glob
    for pat in ARTIFACT_GLOBS:
        for p in glob.glob(os.path.join(REPO_ROOT, pat), recursive=True):
            if os.path.isfile(p):
                yield p


def scan_repo_artifacts(enforced, mcp_price=None):
    """Flag stale prices in the in-repo example/doc files buyers copy.

    Two deterministic, zero-false-positive passes (no hardcoded price roster —
    enforced prices come from the live manifest; degrades open on read error):
      1. same-line pairing (scan_surface) — catches doc rows "/route — $price".
      2. primary-route check for code examples: if a file calls exactly ONE
         paid (non-preview) route by full URL, every price in a COMMENT line
         must equal that route's enforced price (a gate-only example quoting a
         different route's price is a bug, not a cross-reference).
    """
    def _ok_mcp(adv):
        # A price equal to the flat MCP tools/call price is a valid alternative
        # quote for any route also exposed as an MCP tool (the "$0.05 via HTTP,
        # or $0.005 as the MCP tool" dual form) — not a mismatch.
        return mcp_price is not None and abs(adv - mcp_price) <= 1e-9

    mismatches, checked = [], 0
    for path in _iter_artifact_files():
        rel = os.path.relpath(path, REPO_ROOT)
        try:
            txt = open(path, encoding="utf-8").read()
        except Exception as e:  # degrade open
            mismatches.append({"file": rel, "error": str(e)})
            continue
        c, mm = scan_surface(txt, enforced)
        checked += c
        for x in mm:
            if _ok_mcp(x["advertised"]):
                continue
            x["file"] = rel
            mismatches.append(x)
        # primary-route comment-price check (code examples only)
        if path.endswith((".mjs", ".sh")):
            routes = {m.group(1).replace("/preview", "") for m in URL_ROUTE_RE.finditer(txt)}
            paid = [r for r in routes if r in enforced]
            if len(paid) == 1:
                exp = enforced[paid[0]]
                for pm in COMMENT_PRICE_RE.finditer(txt):
                    checked += 1
                    adv = usd_from_str(pm.group(1))
                    if abs(adv - exp) > 1e-9 and not _ok_mcp(adv):
                        mismatches.append({"file": rel, "route": paid[0],
                                           "advertised": adv, "enforced": exp,
                                           "where": "comment"})
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
    mcp_price = None
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

    # In-repo example/doc artifacts (the files a prospect copies to wire a PAID
    # call — invisible to the live-surface scans above).
    try:
        checked, mm = scan_repo_artifacts(enforced, mcp_price)
        realmm = [x for x in mm if "error" not in x]
        result["surfaces"]["repo"] = {"checked": checked, "mismatches": len(realmm)}
        for x in mm:
            if "error" in x:
                result["errors"].append(f"repo {x['file']}: {x['error']}")
                continue
            key = (x.get("file"), x.get("route"), x["advertised"], x["enforced"])
            if key not in seen:
                seen.add(key)
                x["surface"] = "repo"
                result["mismatches"].append(x)
    except Exception as e:  # degrade open
        result["surfaces"]["repo"] = {"error": str(e)}
        result["errors"].append(f"repo: {e}")

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
