#!/usr/bin/env python3
"""Leading-sensor: how many of our routes free crawlers have indexed.

Revenue on x402-data-api is gated by DISCOVERY, not depth. CDP Bazaar indexes a
route only AFTER a settled payment (chicken/egg) and freezes its metadata. The
cheaper, broader lane is the FREE openapi crawlers — x402scan (source:openapi)
and agent402.tools — which re-crawl our workers.dev origin and index every 402
route for $0, no freeze. This sensor records the live indexed-route count on
those surfaces so a stateless loop cycle can read whether a shipped route
actually surfaced to the agent-queried index (the leading metric BEFORE a payer
ever arrives), instead of only reading total_external_usdc (a lagging number
locked under two open experiments).

Degrades open: a crawler that errors is reported with count=None, never crashes
the sensor. Writes/append a dated snapshot to data/x402scan_index.jsonl.
Run keyless; no account. Usage: python3 -I scripts/x402scan_index_sensor.py
"""
import json
import sys
import pathlib
import datetime
import urllib.request

ORIGIN = "https://x402-data-api.sigrunner.workers.dev"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "x402scan_index.jsonl"
# Mirror the latest numbers to the improvement-ledger sensor path so a cycle can
# register a forward-evidence experiment against x402scan_index.x402scan_count.
LATEST = pathlib.Path.home() / ".hermes" / "data" / "x402scan_index" / "latest.json"


def _post(url: str, body: dict, timeout: int = 30):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"content-type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def x402scan_count():
    try:
        d = _post(
            "https://www.x402scan.com/api/trpc/public.resources.checkDiscovery",
            {"json": {"origin": ORIGIN}},
        )["result"]["data"]["json"]
        return {
            "found": bool(d.get("found")),
            "count": d.get("resourceCount"),
            "source": d.get("source"),
        }
    except Exception as e:  # noqa: BLE001 - degrade open
        return {"found": None, "count": None, "error": str(e)[:120]}


def agent402_count():
    try:
        d = _post("https://agent402.tools/api/index/register", {"origin": ORIGIN})
        return {
            "listed": bool(d.get("listed")),
            "count": (d.get("seller") or {}).get("toolCount"),
            "health": (d.get("seller") or {}).get("health"),
        }
    except Exception as e:  # noqa: BLE001 - degrade open
        return {"listed": None, "count": None, "error": str(e)[:120]}


def main() -> int:
    snap = {
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "origin": ORIGIN,
        "x402scan": x402scan_count(),
        "agent402": agent402_count(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("a") as f:
        f.write(json.dumps(snap) + "\n")
    # Flat numeric mirror for the ledger (read_metric wants a number at a dotted path).
    x = snap["x402scan"]["count"]
    a = snap["agent402"]["count"]
    latest = {
        "ts": snap["ts"],
        "x402scan_count": x if isinstance(x, (int, float)) else 0,
        "agent402_count": a if isinstance(a, (int, float)) else 0,
        "crawlers_up": int(snap["x402scan"]["count"] is not None)
        + int(snap["agent402"]["count"] is not None),
    }
    LATEST.parent.mkdir(parents=True, exist_ok=True)
    LATEST.write_text(json.dumps(latest, indent=2))
    print(json.dumps(snap, indent=2))
    # Non-zero only if BOTH crawlers are unreachable (real outage), so it can gate.
    both_dead = snap["x402scan"]["count"] is None and snap["agent402"]["count"] is None
    return 1 if both_dead else 0


if __name__ == "__main__":
    sys.exit(main())
