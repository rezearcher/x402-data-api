#!/usr/bin/env bash
# Usage: pitch_poll.sh [files...]  (default outreach/gh/issues_c*.txt)
# Prints "<human_comments> <state> <url>" for every pitched issue; non-bot, non-owner comments only.
# Parallel (8 workers); also writes ~/.hermes/data/x402_pitch_poll/latest.json.
cd "$(dirname "$0")/.."
export GH_TOKEN=$(git credential fill <<<$'protocol=https\nhost=github.com\n' 2>/dev/null | sed -n 's/^password=//p')  # env GH_TOKEN is stale
files=("$@"); [ ${#files[@]} -eq 0 ] && files=(outreach/gh/issues_c*.txt)
one() { u=$1; p=${u#https://github.com/}; r=${p%/issues/*}; n=${p##*/}
  s=$(gh api "repos/$r/issues/$n" --jq .state 2>/dev/null) || exit 0
  h=$(gh api "repos/$r/issues/$n/comments" --jq '[.[]|select(.user.login!="rezearcher" and (.user.type!="Bot"))]|length' 2>/dev/null)
  echo "${h:-?} $s $u"; }
export -f one
out=$(grep -ho 'https://github.com/[^ ]*/issues/[0-9]*' "${files[@]}" | sort -u | xargs -P8 -I{} bash -c 'one {}' | sort -rn)
echo "$out"
mkdir -p ~/.hermes/data/x402_pitch_poll
echo "$out" | python3 -c 'import sys,json,time;r=[l.split(" ",2) for l in sys.stdin.read().splitlines() if l.strip()];json.dump({"ts":time.time(),"replied":[x for x in r if x[0] not in("0","?")],"total":len(r)},open(sys.argv[1],"w"))' ~/.hermes/data/x402_pitch_poll/latest.json
