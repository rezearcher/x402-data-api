import json,urllib.request,collections
c=json.load(open("/tmp/comp.json"))
tos=sorted({a.lower() for a,u,_ in c if "saylor" not in u})
print(len(tos),"payTo")
def rpc(p):
    r=urllib.request.Request("https://base-rpc.publicnode.com",json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[p]}).encode(),{"Content-Type":"application/json","User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=40))
h=int(json.load(urllib.request.urlopen(urllib.request.Request("https://base-rpc.publicnode.com",json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}).encode(),{"Content-Type":"application/json","User-Agent":"Mozilla/5.0"})))["result"],16)
t="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
pads=["0x"+"0"*24+a[2:] for a in tos]
cnt=collections.Counter(); amt=collections.Counter(); dest=collections.defaultdict(set)
import time
for pd in pads:
  for s in range(h-27000,h,9000):
    try: r=rpc({"fromBlock":hex(s),"toBlock":hex(s+8999),"address":"0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913","topics":[t,None,pd]})
    except Exception as e: print("err",pd[-6:],e); time.sleep(1); continue
    for l in r.get("result",[]):
        f="0x"+l["topics"][1][-40:]; cnt[f]+=1; amt[f]+=int(l["data"],16)/1e6; dest[f].add(l["topics"][2][-40:])
for f,n in cnt.most_common(25): print(f,n,round(amt[f],4),sorted(dest[f]))
print(sum(cnt.values()),"transfers 1d")
