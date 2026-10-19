#!/usr/bin/env bash
# Flags warm prospect threads whose last message is ours and >48h old (nudge due). Writes sensor JSON.
OUT=~/.hermes/data/x402_warm_threads; mkdir -p "$OUT"
python3 - <<'PY'
import os,json,glob,re,time
d=os.path.expanduser('~/projects/x402-data-api/outreach/replies')
rows=[]
for f in glob.glob(d+'/*.md'):
    age=(time.time()-os.path.getmtime(f))/3600
    rows.append({'file':os.path.basename(f),'hours_since_last_note':round(age,1),'nudge_due':age>48})
out={'fetched_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'status':'ok',
 'summary':f"{sum(r['nudge_due'] for r in rows)} of {len(rows)} warm threads nudge-due",
 'alert':any(r['nudge_due'] for r in rows),'threads':rows}
json.dump(out,open(os.path.expanduser('~/.hermes/data/x402_warm_threads/latest.json'),'w'),indent=1)
print(out['summary'])
PY
