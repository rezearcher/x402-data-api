#!/usr/bin/env bash
# Poll pitch issues for non-owner comments; write shared sensor JSON.
cd "$(dirname "$0")/.."
T=$(grep -rh ^GH_TOKEN_CLASSIC .env ~/.env ~/.hermes/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
OUT=~/.hermes/data/x402_issue_replies; mkdir -p "$OUT"
cat outreach/gh/issues*.txt | grep -o 'https://github.com/[^ ]*/issues/[0-9]*' | sort -u | while read u; do
  curl -s -H "Authorization: token $T" "https://api.github.com/repos/${u#https://github.com/}/comments" | U="$u" python3 -c "
import sys,json,os
try:
  for c in json.load(sys.stdin):
    if c['user']['login']!='rezearcher' and not c['user']['login'].endswith('bot'): print(json.dumps({'url':os.environ['U'],'user':c['user']['login'],'at':c['created_at'],'body':c['body'][:200]}))
except Exception: pass"
done > "$OUT/replies.jsonl"
python3 - "$OUT" <<'P'
import sys,json,datetime
d=sys.argv[1]; r=[json.loads(l) for l in open(d+'/replies.jsonl') if l.strip()]
json.dump({"fetched_at":datetime.datetime.utcnow().isoformat()+"Z","status":"ok","summary":f"{len(r)} non-owner pitch replies","alert":len(r)>1,"replies":r},open(d+'/latest.json','w'),indent=1)
P
