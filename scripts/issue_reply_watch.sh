#!/usr/bin/env bash
# Poll pitch issues for non-owner comments; write shared sensor JSON.
cd "$(dirname "$0")/.."
# Secret source (migration cutover 2026-10-19): prefer 1Password vault, fall back
# to plaintext .env so this NEVER breaks if op/the service account is unavailable.
T=""
if [ -z "$T" ]; then
  [ -f "$HOME/.config/greyridge/op.env" ] && . "$HOME/.config/greyridge/op.env" 2>/dev/null
  OP="$(command -v op || echo "$HOME/bin/op")"
  if [ -n "${OP_SERVICE_ACCOUNT_TOKEN:-}" ] && [ -x "$OP" ]; then
    T=$("$OP" read "op://Division/GH_TOKEN_CLASSIC/credential" 2>/dev/null)
  fi
fi
[ -z "$T" ] && T="${GH_TOKEN_CLASSIC:-}"
[ -z "$T" ] && T=$(grep -rh ^GH_TOKEN_CLASSIC .env ~/.env ~/.hermes/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
# Auto-discover every open issue/PR we authored so none is missed by manual registration (I13).
curl -s -G -H "Authorization: token $T" --data-urlencode "q=author:rezearcher is:open comments:>0 -user:rezearcher" -d per_page=100 -d sort=updated https://api.github.com/search/issues | python3 -c "
import sys,json
try:
  for i in json.load(sys.stdin)['items']: print(i['html_url'].replace('/pull/','/issues/'))
except Exception: pass" > outreach/gh/issues_auto.txt
OUT=~/.hermes/data/x402_issue_replies; mkdir -p "$OUT"
cat outreach/gh/issues*.txt | grep -o 'https://github.com/[^ ]*/issues/[0-9]*' | sort -u | while read u; do
  curl -s -H "Authorization: token $T" "https://api.github.com/repos/${u#https://github.com/}/comments" | U="$u" python3 -c "
import sys,json,os
try:
  for c in json.load(sys.stdin):
    if c['user']['login']!='rezearcher' and not c['user']['login'].endswith('bot'): print(json.dumps({'url':os.environ['U'],'user':c['user']['login'],'at':c['created_at'],'body':c['body'][:200]}))
except Exception: pass"
done > "$OUT/replies.jsonl"
# GitHub Discussions we authored (listed in outreach/gh/*.txt as /discussions/N): comments via GraphQL.
cat outreach/gh/issues*.txt | grep -o 'https://github.com/[^ ]*/discussions/[0-9]*' | sort -u | while read u; do
  p=${u#https://github.com/}; p=${p#orgs/}; o=${p%%/*}; r=${p#*/}; r=${r%%/*}; n=${p##*/}
  if [[ "$u" == *"/orgs/"* ]]; then r=eliza; fi
  curl -s -H "Authorization: bearer $T" -d "{\"query\":\"{repository(owner:\\\"$o\\\",name:\\\"$r\\\"){discussion(number:$n){comments(first:50){nodes{createdAt body author{login}}}}}}\"}" https://api.github.com/graphql | U="$u" python3 -c "
import sys,json,os
try:
  for c in json.load(sys.stdin)['data']['repository']['discussion']['comments']['nodes']:
    if c['author']['login']!='rezearcher': print(json.dumps({'url':os.environ['U'],'user':c['author']['login'],'at':c['createdAt'],'body':c['body'][:200]}))
except Exception: pass"
done >> "$OUT/replies.jsonl"
python3 - "$OUT" <<'P'
import sys,json,datetime
d=sys.argv[1]; r=[json.loads(l) for l in open(d+'/replies.jsonl') if l.strip()]
json.dump({"fetched_at":datetime.datetime.utcnow().isoformat()+"Z","status":"ok","summary":f"{len(r)} non-owner pitch replies","alert":len(r)>1,"replies":r},open(d+'/latest.json','w'),indent=1)
P
