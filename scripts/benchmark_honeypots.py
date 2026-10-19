#!/usr/bin/env python3
"""L4b: recall on GoPlus-flagged honeypots. Scans GeckoTerminal new Base pools (no liquidity floor), keeps GoPlus is_honeypot==1, asks our preview."""
import json, urllib.request, time, os
UA = {"User-Agent": "curl/8.5.0"}
def get(u):
    try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))
    except Exception: return None
seen, pos, neg = set(), [], []
for pg in range(1, 11):
    d = get(f"https://api.geckoterminal.com/api/v2/networks/base/new_pools?page={pg}")
    for p in (d or {}).get("data", []):
        a = p["relationships"]["base_token"]["data"]["id"].split("_")[-1].lower()
        if a in seen: continue
        seen.add(a)
        g = get("https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=" + a)
        gp = ((g or {}).get("result") or {}).get(a)
        if not gp: continue
        (pos if gp.get("is_honeypot") == "1" else neg).append(a)
    time.sleep(2.2)
rows = []
for a, lab in [(x, True) for x in pos] + [(x, False) for x in neg[:30]]:
    o = get("https://api.greyridgesignals.ai/chain/token-report/preview?token=" + a)
    if o and "security" in o:
        rows.append({"token": a, "goplus_honeypot": lab, "ours_honeypot": bool(o["security"].get("isHoneypot")), "verdict": o.get("verdict"), "score": o.get("risk_score"), "simStatus": o["security"].get("simStatus")})
    time.sleep(0.4)
tp = sum(r["goplus_honeypot"] and r["ours_honeypot"] for r in rows); fn = sum(r["goplus_honeypot"] and not r["ours_honeypot"] for r in rows)
fp = sum((not r["goplus_honeypot"]) and r["ours_honeypot"] for r in rows)
avoid_pos = sum(r["goplus_honeypot"] and r["verdict"] == "AVOID" for r in rows)
res = {"scanned": len(seen), "gp_positive": len(pos), "rows": len(rows), "tp": tp, "fn": fn, "fp": fp, "positives_AVOID": avoid_pos}
os.makedirs("data", exist_ok=True); json.dump({**res, "rows": rows}, open("data/benchmark_honeypots.json", "w"), indent=1); print(res)
