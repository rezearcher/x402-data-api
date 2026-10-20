#!/bin/bash
# Measures /scan/mcp/preview POST accuracy on benchmarks/mcp_scan_corpus.json (labels: bad=poisoned, good=benign).
# Verdict != clear counts as flagged. Writes benchmarks/mcp_scan_results.json.
B=${B:-https://x402-data-api.sigrunner.workers.dev}
cd "$(dirname "$0")/.."
python3 - "$B" <<'PY'
import json,sys,urllib.request
B=sys.argv[1]; C=json.load(open("benchmarks/mcp_scan_corpus.json"))
tp=fp=tn=fn=0; rows=[]
for c in C:
    body=json.dumps({"tools":[{"name":c["name"],"description":c["description"],"inputSchema":{"type":"object","properties":{}}}]}).encode()
    r=urllib.request.Request(B+"/scan/mcp/preview",body,{"Content-Type":"application/json","User-Agent":"bench/1"})
    try: v=json.load(urllib.request.urlopen(r,timeout=30)); verdict=v.get("verdict") or v.get("scan",{}).get("verdict")
    except Exception as e: verdict="ERR:"+str(e)[:40]
    flagged = verdict not in ("clear",) and not str(verdict).startswith("ERR")
    bad=c["label"]=="bad"
    if bad and flagged: tp+=1
    elif bad: fn+=1
    elif flagged: fp+=1
    else: tn+=1
    rows.append({"name":c["name"],"label":c["label"],"verdict":verdict})
res={"endpoint":B,"n":len(C),"tp":tp,"fn":fn,"fp":fp,"tn":tn,
 "recall":round(tp/max(tp+fn,1),3),"precision":round(tp/max(tp+fp,1),3),"rows":rows}
json.dump(res,open("benchmarks/mcp_scan_results.json","w"),indent=1)
print({k:v for k,v in res.items() if k!="rows"})
for r in rows:
    if (r["label"]=="bad")!=(r["verdict"]!="clear"): print("MISS",r)
PY
