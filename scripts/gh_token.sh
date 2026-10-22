#!/usr/bin/env bash
# Grey Ridge — resolve a WORKING GitHub token for rezearcher.
#
# Why this exists: for ~14 cycles the loop believed GitHub was dead because the
# ambient $GH_TOKEN / $GITHUB_TOKEN env vars hold a stale/expired value that
# returns "401 Bad credentials". A valid CLASSIC PAT (scopes: repo, workflow, ...)
# lives in 1Password at op://Division/GH_TOKEN_CLASSIC. This script returns the
# first token that actually authenticates as rezearcher, preferring 1Password.
#
# Usage:
#   TOK=$(scripts/gh_token.sh)                 # prints a working token, or exits 1
#   git push "https://x-access-token:$TOK@github.com/rezearcher/<repo>.git" <branch>
#   GH_TOKEN=$TOK gh pr create ...             # gh honors GH_TOKEN
set -euo pipefail

_auths() { # $1 = token -> 0 if it authenticates as rezearcher
  [ -n "${1:-}" ] || return 1
  curl -s -H "Authorization: Bearer $1" https://api.github.com/user \
    | grep -q '"login": *"rezearcher"'
}

# 0) ~/.git-credentials (local, instant, no rate limit). git caches a working
#    PAT here as x-access-token:<tok>@github.com. This is the ONLY source that
#    survives a 1Password service-account rate-limit (which has blocked `op read`
#    for days at a time), so it is tried FIRST. Caught 2026-10-22 after ~14
#    cycles wrongly concluded "writes dead" while a valid PAT sat in this file.
if [ -f "$HOME/.git-credentials" ]; then
  while IFS= read -r line; do
    tok="$(printf '%s' "$line" | sed -nE 's#^https://x-access-token:([^@]+)@github\.com.*#\1#p')"
    if _auths "$tok"; then echo "$tok"; exit 0; fi
  done < "$HOME/.git-credentials"
fi

# 1) 1Password classic PAT (the known-good source)
if [ -f "$HOME/.config/greyridge/op.env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.config/greyridge/op.env" 2>/dev/null || true
  for item in GH_TOKEN_CLASSIC division-GH_TOKEN division-GITHUB_TOKEN; do
    tok="$(op read "op://Division/${item}/credential" 2>/dev/null || true)"
    if _auths "$tok"; then echo "$tok"; exit 0; fi
  done
fi

# 2) fall back to ambient env (only if it happens to still work)
for tok in "${GH_TOKEN:-}" "${GITHUB_TOKEN:-}"; do
  if _auths "$tok"; then echo "$tok"; exit 0; fi
done

echo "gh_token.sh: no working GitHub token found (1Password + env all failed)" >&2
exit 1
