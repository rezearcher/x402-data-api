#!/usr/bin/env python3
"""L1/L2 measurement: probe key free previews, append samples, write shared sensor.
Claims law: publish only numbers computed from data/uptime_samples.jsonl."""
import json, time, urllib.request, datetime, os, statistics
BASE = "https://api.greyridgesignals.ai"
EPS = ["/gate/swap/preview?token=degen", "/chain/token-report/preview?token=aero",
       "/chain/token-security/preview", "/chain/gas-price/preview", "/crypto/prices/preview"]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(root, "data", "uptime_samples.jsonl"); os.makedirs(os.path.dirname(LOG), exist_ok=True)
now = datetime.datetime.utcnow().isoformat() + "Z"
with open(LOG, "a") as f:
    for ep in EPS:
        t = time.time(); ok = False; code = 0
        try:
            r = urllib.request.urlopen(urllib.request.Request(BASE + ep, headers={"User-Agent": "curl/8.5.0"}), timeout=20)
            code = r.status; r.read(); ok = code == 200
        except urllib.error.HTTPError as e: code = e.code
        except Exception: code = 0
        f.write(json.dumps({"t": now, "ep": ep.split("?")[0], "ok": ok, "code": code, "ms": int((time.time() - t) * 1000)}) + "\n")
S = {}
for l in open(LOG):
    d = json.loads(l); S.setdefault(d["ep"], []).append(d)
out = {}
for ep, v in S.items():
    ms = sorted(x["ms"] for x in v if x["ok"])
    p = lambda q: ms[min(len(ms) - 1, int(q * len(ms)))] if ms else None
    out[ep] = {"n": len(v), "uptime_pct": round(100 * sum(x["ok"] for x in v) / len(v), 2), "p50_ms": p(.5), "p95_ms": p(.95), "first": v[0]["t"]}
d = os.path.expanduser("~/.hermes/data/x402-data-api-uptime"); os.makedirs(d, exist_ok=True)
json.dump({"fetched_at": now, "status": "ok", "summary": f"{len(S)} eps, n={sum(o['n'] for o in out.values())}", "alert": False, "endpoints": out}, open(d + "/latest.json", "w"), indent=1)
print(json.dumps(out, indent=1))
