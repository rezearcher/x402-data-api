# Sensor: distinct external payers + external USDC over a window vs the x402stats "organic" bar (>=$100/30d, >=3 buyers).
# Run: python3 -I scripts/payer_bar_sensor.py [days]  -> ~/.hermes/data/x402_payer_bar/latest.json
import json,sys,os,time,urllib.request,collections
DAYS=float(sys.argv[1]) if len(sys.argv)>1 else 2
W="0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10"
OURS={W,"0xc4852c26498d3187dec2ce1b19e840710e302d1e","0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685","0x78aad7cec7f3d7dde0b0a3f3708304d2000a19ac3"[:42]}
T="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
USDC="0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913"
def rpc(m,p):
    r=urllib.request.Request("https://base-rpc.publicnode.com",json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),{"Content-Type":"application/json","User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=30))
h=int(rpc("eth_blockNumber",[])["result"],16)
start=h-int(DAYS*43200); pad="0x"+"0"*24+W[2:]
amt=collections.Counter(); n=collections.Counter(); err=0
b=start
while b<h:
    e=min(b+8999,h)
    for attempt in range(4):
      try:
        for l in rpc("eth_getLogs",[{"fromBlock":hex(b),"toBlock":hex(e),"address":USDC,"topics":[T,None,pad]}]).get("result",[]):
            f="0x"+l["topics"][1][-40:]
            if f in OURS: continue
            amt[f]+=int(l["data"],16)/1e6; n[f]+=1
        break
      except Exception:
        time.sleep(2*(attempt+1))
        if attempt==3: err+=1
    b=e+1
tot=sum(amt.values()); proj=tot/DAYS*30
out={"fetched_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"status":"ok" if not err else "partial","window_days":DAYS,
 "distinct_external_payers":len(amt),"external_usdc":round(tot,4),"projected_30d_usdc":round(proj,2),
 "bar":{"usd_30d":100,"buyers":3},"meets_bar":proj>=100 and len(amt)>=3,"rpc_errors":err,
 "payers":{k:{"usdc":round(v,4),"tx":n[k]} for k,v in amt.most_common(10)}}
out["summary"]=f"{len(amt)} ext payers, ${tot:.3f}/{DAYS}d (proj ${proj:.2f}/30d) vs bar $100 & 3 buyers"
out["alert"]=False
d=os.path.expanduser("~/.hermes/data/x402_payer_bar"); os.makedirs(d,exist_ok=True)
json.dump(out,open(d+"/latest.json","w"),indent=1); print(json.dumps(out,indent=1))
