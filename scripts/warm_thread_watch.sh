#!/usr/bin/env bash
# Warm-lead nudge gate. GROUND TRUTH = thread last-sender (outreach/warm_leads.json),
# NOT file mtime. A lead is nudge_due ONLY when the LAST message is theirs (last_dir=="them")
# AND now is past its do_not_send_until. last_dir=="us" => ball-in-court on THEM => never nudge.
# Reply-note files with no ledger entry are surfaced as "review" (degrade open), never auto-nudge.
cd "$(dirname "$0")/.."
OUT=~/.hermes/data/x402_warm_threads; mkdir -p "$OUT"
python3 -I - <<'PY'
import os,json,glob,time,datetime
root=os.path.expanduser('~/projects/x402-data-api')
led=os.path.join(root,'outreach/warm_leads.json')
now=datetime.datetime.now(datetime.timezone.utc)
def parse(s):
    try: return datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
    except Exception: return None
leads=[]
tracked_threads=set()
if os.path.exists(led):
    data=json.load(open(led))
    for L in data.get('leads',[]):
        tracked_threads.add(L.get('thread_id',''))
        last_at=parse(L.get('last_at','')); dns=parse((L.get('do_not_send_until','')+'T00:00:00+00:00') if len(L.get('do_not_send_until',''))==10 else L.get('do_not_send_until',''))
        hrs=round((now-last_at).total_seconds()/3600,1) if last_at else None
        # Nudge is permitted ONLY if the ball is in THEIR court was returned to US (they spoke last)
        # and we are past the agreed quiet window.
        nudge_due = (L.get('last_dir')=='them') and (dns is None or now>=dns) and (hrs is None or hrs>48)
        leads.append({'lead':L.get('lead'),'last_dir':L.get('last_dir'),
                      'hours_since_last':hrs,'do_not_send_until':L.get('do_not_send_until'),
                      'status':L.get('status'),'nudge_due':bool(nudge_due)})
# Degrade open: reply-note files that aren't represented by any tracked lead -> needs manual review.
notes=glob.glob(os.path.join(root,'outreach/replies','*.md'))
review=[]
for f in notes:
    age=round((time.time()-os.path.getmtime(f))/3600,1)
    if age>72:  # only old ones are worth surfacing for review
        review.append({'file':os.path.basename(f),'hours_old':age})
due=[l for l in leads if l['nudge_due']]
out={'fetched_at':now.strftime('%Y-%m-%dT%H:%M:%SZ'),'status':'ok',
     'summary':f"{len(due)} of {len(leads)} tracked warm leads nudge-due (ground-truth last-sender); {len(review)} old reply-notes to review",
     'alert':bool(due),'leads':leads,'nudge_due':due,'review_untracked':review[:10]}
json.dump(out,open(os.path.expanduser('~/.hermes/data/x402_warm_threads/latest.json'),'w'),indent=1)
print(out['summary'])
PY
