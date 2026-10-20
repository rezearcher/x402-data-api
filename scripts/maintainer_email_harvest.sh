#!/usr/bin/env bash
# Usage: maintainer_email_harvest.sh owner/repo [owner/repo...]
# Prints: repo | top non-bot commit-author email | MX ok? | already-emailed?
# Needs GH_TOKEN. Send manually via gmail-me; log to outreach/sent/c40_emails.log.
for r in "$@"; do
  e=$(gh api "repos/$r/commits?per_page=15" --jq '.[].commit.author.email' 2>/dev/null \
      | grep -v -i -E 'noreply|bot|root@|localhost|example\.com|ci@' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
  [ -z "$e" ] && { echo "$r | none"; continue; }
  d=${e#*@}
  mx=$(dig +short MX "$d" | head -1); [ -n "$mx" ] && mx=ok || mx=NOMX
  sent=no; grep -qi "$e" "$(dirname "$0")/../outreach/sent/c40_emails.log" 2>/dev/null && sent=yes
  echo "$r | $e | $mx | sent=$sent"
done
