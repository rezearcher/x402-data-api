#!/usr/bin/env python3
"""L1/L2 measurement: probe key free previews, append samples, write shared sensor.
Claims law: publish only numbers computed from data/uptime_samples.jsonl."""
import json, time, urllib.request, datetime, os, statistics
BASE = "https://api.greyridgesignals.ai"
# GET free-preview probes. (path, None) = GET; (path, body_dict) = POST JSON.
# /scan/mcp/preview is the paste-mode conversion entrance warm MCP-scan leads hit — monitor it so
# a silent break (deploy regression, DO-limit incident) alerts instead of killing leads quietly.
EPS = [("/gate/swap/preview?token=degen", None), ("/chain/token-report/preview?token=aero", None),
       ("/chain/token-security/preview", None), ("/chain/gas-price/preview", None),
       ("/crypto/prices/preview", None),
       ("/scan/mcp/preview", {"tools": [{"name": "healthcheck", "description": "uptime probe, no-op"}]})]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(root, "data", "uptime_samples.jsonl"); os.makedirs(os.path.dirname(LOG), exist_ok=True)
now = datetime.datetime.utcnow().isoformat() + "Z"
with open(LOG, "a") as f:
    for ep, body in EPS:
        t = time.time(); ok = False; code = 0
        try:
            hdr = {"User-Agent": "curl/8.5.0"}
            data = None
            if body is not None:
                data = json.dumps(body).encode(); hdr["Content-Type"] = "application/json"
            r = urllib.request.urlopen(urllib.request.Request(BASE + ep, data=data, headers=hdr), timeout=20)
            code = r.status; r.read(); ok = code == 200
        except urllib.error.HTTPError as e: code = e.code
        except Exception: code = 0
        f.write(json.dumps({"t": now, "ep": ep.split("?")[0], "ok": ok, "code": code, "ms": int((time.time() - t) * 1000)}) + "\n")
S = {}
for l in open(LOG):
    d = json.loads(l); S.setdefault(d["ep"], []).append(d)
out = {}; degraded = []
for ep, v in S.items():
    ms = sorted(x["ms"] for x in v if x["ok"])
    p = lambda q: ms[min(len(ms) - 1, int(q * len(ms)))] if ms else None
    recent = v[-12:]; recent_ok = round(100 * sum(x["ok"] for x in recent) / len(recent), 1)
    out[ep] = {"n": len(v), "uptime_pct": round(100 * sum(x["ok"] for x in v) / len(v), 2), "recent_ok_pct": recent_ok, "p50_ms": p(.5), "p95_ms": p(.95), "first": v[0]["t"]}
    if recent_ok < 80:  # recent window degraded — a live break of a conversion-funnel route
        degraded.append(f"{ep} recent_ok={recent_ok}%")
d = os.path.expanduser("~/.hermes/data/x402-data-api-uptime"); os.makedirs(d, exist_ok=True)
alert = bool(degraded)
summary = f"{len(S)} eps, n={sum(o['n'] for o in out.values())}" + (f" | ALERT degraded: {'; '.join(degraded)}" if degraded else "")
json.dump({"fetched_at": now, "status": "ok", "summary": summary, "alert": alert, "degraded": degraded, "endpoints": out}, open(d + "/latest.json", "w"), indent=1)
print(json.dumps(out, indent=1))
