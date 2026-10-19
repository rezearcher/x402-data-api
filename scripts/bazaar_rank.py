#!/usr/bin/env python3
"""Rank of greyridgesignals routes in CDP Bazaar semantic search for buyer-style queries."""
import json, sys, urllib.parse, urllib.request
QS = sys.argv[1:] or ["token security honeypot","token safety check before swap","pre-trade safety gate","is this token a scam","rug pull check base token","token risk report","base token holders","ethereum wallet balance","contract is verified"]
for q in QS:
    u="https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?"+urllib.parse.urlencode({"query":q,"limit":20})
    try: d=json.load(urllib.request.urlopen(u,timeout=25))
    except Exception as e: print(q,"ERR",e); continue
    rs=d.get("resources",[])
    ranks=[i for i,r in enumerate(rs) if ("sigrunner" in (r.get("resource") or "") or "greyridge" in (r.get("resource") or r.get("url") or ""))]
    print(f"{q!r}: n={len(rs)} ours_ranks={ranks}", [ (rs[i].get('resource') or '')[-40:] for i in ranks[:3]])
