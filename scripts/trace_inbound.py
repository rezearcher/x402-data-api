# Lists inbound USDC transfers (last ~9000 Base blocks) to the receiving wallet; OURS = our own wallets. Run: python3 -I scripts/trace_inbound.py
import json,urllib.request
def rpc(m,p,u="https://base-rpc.publicnode.com"):
    r=urllib.request.Request(u,json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),{"Content-Type":"application/json","User-Agent":"Mozilla/5.0"})
    return json.load(urllib.request.urlopen(r,timeout=30))
W="0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10"
pad="0x"+"0"*24+W[2:]
t="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
h=int(rpc("eth_blockNumber",[])["result"],16)
r=rpc("eth_getLogs",[{"fromBlock":hex(h-9000),"toBlock":hex(h),"address":"0x833589fCd6eDb6E08f4c7C32D4f71b54bdA02913","topics":[t,None,pad]}])
print(str(r)[:300])
OURS={"0xc4852c26498d3187dec2ce1b19e840710e302d1e","0x95e6a9761522e9533d74bbebe47e1c5ad8e3c685"}
for l in r.get("result",[]):
    f="0x"+l["topics"][1][-40:]
    print("OURS" if f in OURS else "EXTERNAL",int(l["blockNumber"],16),f,int(l["data"],16)/1e6)
