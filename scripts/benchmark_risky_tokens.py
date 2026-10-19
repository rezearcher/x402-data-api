#!/usr/bin/env python3
"""L4c: agreement with GoPlus on 'sell-blocked or confiscatory' tokens (is_honeypot==1 OR cannot_sell_all==1 OR sell_tax>=0.5), scanning new+trending Base pools.
Measures agreement vs GoPlus only (not ground truth). Writes data/benchmark_risky.json."""
import json, urllib.request, time, os
UA = {"User-Agent": "curl/8.5.0"}
def get(u):
    try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))
    except Exception: return None
def f(x):
    try: return float(x)
    except Exception: return 0.0
seen, pos, neg = set(), [], []
for kind in ("new_pools", "trending_pools", "pools"):
    for pg in range(1, 8):
        d = get(f"https://api.geckoterminal.com/api/v2/networks/base/{kind}?page={pg}")
        for p in (d or {}).get("data", []):
            a = p["relationships"]["base_token"]["data"]["id"].split("_")[-1].lower()
            if a in seen: continue
            seen.add(a)
            g = get("https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=" + a)
            gp = ((g or {}).get("result") or {}).get(a)
            if not gp: continue
            bad = gp.get("is_honeypot") == "1" or gp.get("cannot_sell_all") == "1" or f(gp.get("sell_tax")) >= 0.5
            (pos if bad else neg).append(a)
        time.sleep(2.2)
print("scanned", len(seen), "pos", len(pos))
rows = []
for a, lab in [(x, True) for x in pos] + [(x, False) for x in neg[:40]]:
    o = get("https://api.greyridgesignals.ai/chain/token-report/preview?token=" + a)
    if o and "security" in o:
        rows.append({"token": a, "goplus_bad": lab, "verdict": o.get("verdict"), "score": o.get("risk_score"), "isHoneypot": bool(o["security"].get("isHoneypot"))})
    time.sleep(0.4)
flag = lambda r: r["verdict"] in ("AVOID", "CAUTION") or r["isHoneypot"]
tp = sum(r["goplus_bad"] and flag(r) for r in rows); fn = sum(r["goplus_bad"] and not flag(r) for r in rows)
fp = sum((not r["goplus_bad"]) and flag(r) for r in rows)
res = {"scanned": len(seen), "gp_bad": len(pos), "rows": len(rows), "tp": tp, "fn": fn, "fp": fp}
os.makedirs("data", exist_ok=True); json.dump({**res, "rows": rows}, open("data/benchmark_risky.json", "w"), indent=1); print(res)
