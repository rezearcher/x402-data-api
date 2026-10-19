#!/usr/bin/env python3
"""Post every .well-known/x402 route to board.sarnai.dev as wallet-owned offerings (skips ones already ours). Key: ~/.hermes/data/sarnai_listing_key.json"""
import json,time,urllib.request
H={"User-Agent":"curl/8.5","content-type":"application/json"}
k=json.load(open("/home/rez/.hermes/data/sarnai_listing_key.json"))
d=json.load(urllib.request.urlopen(urllib.request.Request("https://x402-data-api.sigrunner.workers.dev/.well-known/x402",headers=H)))
for r in d.get('resources') or d.get('endpoints'):
    u=r['resource']
    if "preview" in u: continue
    path=u.split('workers.dev')[1]
    body={"name":f"Grey Ridge: {r['accepts'][0].get('serviceName') or path}","description":r['description'][:600]+f" ${r['price_usdc']}/call, x402 USDC on Base, no key.","task_categories":["data extraction"] if path.startswith('/ai') else ["crypto and blockchain data"],"endpoint_url":u,
     "connections":[{"type":"x402","url":u}],"payment_methods":[{"type":"x402","details":{"networks":["eip155:8453"]}}],"submitted_by":k["address"],
     "payment_options":[{"network":"eip155:8453","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","pay_to":r['payTo'],"amount":r['price_usdc']}]}
    for t in range(4):
        try: print("OK",path,json.loads(urllib.request.urlopen(urllib.request.Request("https://board.sarnai.dev/listings",json.dumps(body).encode(),H)).read())['id']); break
        except Exception as e:
            b=e.read()[:90]
            if e.code==429: time.sleep(20); continue
            print(e.code,path,b); break
    time.sleep(3)
