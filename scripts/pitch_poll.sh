#!/usr/bin/env bash
# Usage: pitch_poll.sh [files...]  (default outreach/gh/issues_c*.txt)
# Prints "<human_comments> <state> <url>" for every pitched issue; non-bot, non-owner comments only.
cd "$(dirname "$0")/.."
export GH_TOKEN=${GH_TOKEN:-$(git credential fill <<<$'protocol=https\nhost=github.com\n' 2>/dev/null | sed -n 's/^password=//p')}
files=("$@"); [ ${#files[@]} -eq 0 ] && files=(outreach/gh/issues_c*.txt)
grep -ho 'https://github.com/[^ ]*/issues/[0-9]*' "${files[@]}" | sort -u | while read -r u; do
  p=${u#https://github.com/}; r=${p%/issues/*}; n=${p##*/}
  s=$(gh api "repos/$r/issues/$n" --jq .state 2>/dev/null) || continue
  h=$(gh api "repos/$r/issues/$n/comments" --jq '[.[]|select(.user.login!="rezearcher" and (.user.type!="Bot"))]|length' 2>/dev/null)
  echo "${h:-?} $s $u"
done | sort -rn
