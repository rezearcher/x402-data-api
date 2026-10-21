#!/usr/bin/env python3
"""Surface ↔ demand alignment sensor.

The machine-import surface (`/.well-known/x402` `resources[]`) is ordered so
the FIRST resource leads with our strongest lane. "Strongest" must not be a
hand-picked guess that silently drifts — it is defined by MEASURED on-chain
demand: scripts/onchain_demand_by_lane.py scans each competitor payTo in our
lanes and records real USDC settled per lane in
~/.hermes/data/x402-demand/onchain_demand_by_lane.json.

This sensor asserts the live surface still leads with the top-demand lane's
route. If demand re-ranks lanes (e.g. yields overtakes token-safety), the
surface's lead resource should be re-pointed — this flags that drift instead
of letting an outdated hand-pick rot. No hardcoded lane/route roster: both the
target route (top lane's `our_cheapest_route`) and the live lead resource are
read at runtime. Degrades OPEN — a missing artifact or unreachable surface is
reported as a WARN, never a silent pass.

Run:  python3 -I scripts/surface_demand_alignment_sensor.py
Writes ~/.hermes/data/x402_surface_alignment/latest.json
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("X402_BASE", "https://x402-data-api.sigrunner.workers.dev")
DEMAND = os.path.expanduser("~/.hermes/data/x402-demand/onchain_demand_by_lane.json")
OUT_DIR = os.path.expanduser("~/.hermes/data/x402_surface_alignment")


def _get(url, timeout=20):
    req = urllib.request.Request(url, headers={"user-agent": "greyridge-surface-sensor/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    now = datetime.now(timezone.utc).isoformat()
    out = {"ts": now, "base": BASE, "status": "ok", "alert": False}

    # 1) top measured-demand lane + its route (degrade open if artifact missing)
    try:
        d = json.load(open(DEMAND))
        lanes = sorted(d.get("lanes", []), key=lambda ln: ln.get("external_usdc_observed", 0), reverse=True)
        if not lanes:
            raise ValueError("no lanes in demand artifact")
        top = lanes[0]
        target_route = (top.get("our_cheapest_route") or "").rstrip("/")
        out["top_demand_lane"] = top.get("lane")
        out["top_demand_usd"] = top.get("external_usdc_observed")
        out["expected_lead_route"] = target_route
        out["demand_generated_at"] = d.get("generated_at")
    except Exception as e:
        out.update(status="warn", alert=True, reason=f"demand artifact unreadable: {e}")
        _write(out, now)
        return 0  # degrade open — don't hard-fail CI on a missing sensor input

    # 2) live surface lead resource
    try:
        wk = _get(f"{BASE}/.well-known/x402")
        res = wk.get("resources") or []
        lead = res[0] if res else {}
        lead_route = (lead.get("resource") or lead.get("path") or lead.get("url") or "")
        # normalise a full URL down to its path
        if lead_route.startswith("http"):
            from urllib.parse import urlparse
            lead_route = urlparse(lead_route).path
        lead_route = lead_route.rstrip("/")
        out["live_lead_route"] = lead_route
    except Exception as e:
        out.update(status="warn", alert=True, reason=f"live well-known unreachable: {e}")
        _write(out, now)
        return 0

    # 3) assert alignment
    aligned = bool(target_route) and lead_route == target_route
    out["aligned"] = aligned
    if not aligned:
        out["alert"] = True
        out["reason"] = (
            f"surface lead route '{lead_route}' != top-demand lane "
            f"'{out['top_demand_lane']}' route '{target_route}' — re-point the "
            f"well-known resources[] lead or re-check demand ranking"
        )
    _write(out, now)
    print(json.dumps({k: out[k] for k in (
        "status", "alert", "aligned", "top_demand_lane", "expected_lead_route", "live_lead_route"
    ) if k in out}, indent=2))
    return 0


def _write(out, now):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "latest.json"), "w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    sys.exit(main())
