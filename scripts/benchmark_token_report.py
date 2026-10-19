#!/usr/bin/env python3
"""L4: agreement of /chain/token-report/preview vs GoPlus (Base, chain 8453) on honeypot/sellability.
Tokens: Dexscreener Base search results. Writes data/benchmark_token_report.json. Publish only what this prints."""
import json, urllib.request, time, sys, os
UA = {"User-Agent": "curl/8.5.0"}
def get(u):
    try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))
    except Exception as e: return None
toks = []
for kind in ["new_pools", "pools", "trending_pools"]:
    for pg in range(1, 6):
        d = get(f"https://api.geckoterminal.com/api/v2/networks/base/{kind}?page={pg}")
        for p in (d or {}).get("data", []):
            r = p["relationships"]["base_token"]["data"]["id"].split("_")[-1].lower()
            if r not in toks and float(p["attributes"].get("reserve_in_usd") or 0) > 1000: toks.append(r)
        time.sleep(2.2)
toks = toks[:int(sys.argv[1]) if len(sys.argv) > 1 else 120]
rows = []
for a in toks:
    g = get("https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=" + a)
    gp = ((g or {}).get("result") or {}).get(a)
    o = get("https://api.greyridgesignals.ai/chain/token-report/preview?token=" + a)
    if not gp or not o or "security" not in o: continue
    rows.append({"token": a, "goplus_honeypot": gp.get("is_honeypot") == "1", "ours_honeypot": bool(o["security"].get("isHoneypot")),
                 "ours_sellable": o["security"].get("sellable"), "verdict": o.get("verdict"), "score": o.get("risk_score")})
    time.sleep(0.5)
n = len(rows); agree = sum(r["goplus_honeypot"] == r["ours_honeypot"] for r in rows)
tp = sum(r["goplus_honeypot"] and r["ours_honeypot"] for r in rows); fp = sum((not r["goplus_honeypot"]) and r["ours_honeypot"] for r in rows)
fn = sum(r["goplus_honeypot"] and not r["ours_honeypot"] for r in rows)
res = {"n": n, "agreement_pct": round(100 * agree / n, 1) if n else None, "tp": tp, "fp": fp, "fn": fn, "goplus_positive": tp + fn,
       "verdicts": {v: sum(r["verdict"] == v for r in rows) for v in {r["verdict"] for r in rows}}, "rows": rows}
os.makedirs("data", exist_ok=True); json.dump(res, open("data/benchmark_token_report.json", "w"), indent=1)
print({k: v for k, v in res.items() if k != "rows"})
