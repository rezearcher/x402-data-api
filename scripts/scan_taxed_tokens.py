import json,urllib.request,time
UA={"User-Agent":"curl/8.5.0"}
def get(u):
    try: return json.load(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30))
    except Exception: return None
seen=set();hits=[]
for kind in ("new_pools","trending_pools","pools"):
    for pg in range(1,8):
        d=get(f"https://api.geckoterminal.com/api/v2/networks/base/{kind}?page={pg}")
        for p in (d or {}).get("data",[]):
            a=p["relationships"]["base_token"]["data"]["id"].split("_")[-1].lower()
            if a in seen: continue
            seen.add(a)
            g=get("https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses="+a)
            gp=((g or {}).get("result") or {}).get(a)
            if not gp: continue
            try: s=max(float(gp.get("sell_tax") or 0),float(gp.get("buy_tax") or 0))
            except: s=0
            if s>=0.03 and gp.get("is_honeypot")!="1":
                o=get("https://api.greyridgesignals.ai/chain/token-report/preview?token="+a)
                t=(o or {}).get("security",{}).get("transferTaxBps","?")
                hits.append((a,s,t,gp.get("transfer_pausable"))); print(a,s,t,flush=True)
        time.sleep(2.2)
print(len(seen),len(hits))
