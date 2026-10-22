#!/usr/bin/env bash
# Grey Ridge — submit the Security listing PR to punkpeye/awesome-mcp-servers
# (96.7k stars, actively maintained, human-browsed MCP directory; its Security
# category already lists direct Base/x402 safety peers but not us). This is a
# high-authority dofollow backlink to ignite Google crawl of our scanner pages
# (measured 0 crawl hits/30d) + direct human discovery.
#
# Idempotent: re-running after the PR exists is a no-op. Zero-Rez once a GitHub
# token resolves (scripts/gh_token.sh via 1Password, or ambient $GH_TOKEN).
#
#   bash scripts/submit_punkpeye_listing.sh
set -euo pipefail

UPSTREAM="punkpeye/awesome-mcp-servers"
FORK="rezearcher/awesome-mcp-servers"
BRANCH="add-grey-ridge-security-scanner"
ENTRY='- [rezearcher/x402-data-api](https://github.com/rezearcher/x402-data-api) 📇 ☁️ - Pre-trust safety checks for agents on Base over x402: a static MCP tool-poisoning and prompt-injection scan (OWASP LLM01/LLM08), ERC-20 token-safety and honeypot detection, and swap preflight that returns an allow, hold or block decision.'
MARKER='rezearcher/x402-data-api'
SECTION_ANCHOR='<a name="social-media"></a>'  # first header AFTER the Security section

cd "$(dirname "$0")/.."

TOK="$(bash scripts/gh_token.sh 2>/dev/null || true)"
[ -z "$TOK" ] && TOK="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOK" ]; then
  echo "FATAL: no GitHub token (1Password rate-limited? ambient dead?). Retry later." >&2
  exit 1
fi
export GH_TOKEN="$TOK"

# Already open?
if gh pr list --repo "$UPSTREAM" --author rezearcher --state all --json title,url \
     --jq '.[].url' 2>/dev/null | grep -q .; then
  echo "A PR from rezearcher already exists on $UPSTREAM:"
  gh pr list --repo "$UPSTREAM" --author rezearcher --state all --json url,state --jq '.[] | "\(.state) \(.url)"'
  exit 0
fi

# Fork (no-op if it exists)
gh repo fork "$UPSTREAM" --clone=false 2>/dev/null || true
sleep 3

WORK="$(mktemp -d /tmp/punk_pr.XXXXXX)"
git clone --depth 1 "https://x-access-token:${TOK}@github.com/${FORK}.git" "$WORK/repo" 2>&1 | tail -2
cd "$WORK/repo"
# Keep fork in sync with upstream default branch so the diff is clean
DEF="$(gh repo view "$UPSTREAM" --json defaultBranchRef --jq '.defaultBranchRef.name')"
git remote add upstream "https://github.com/${UPSTREAM}.git"
git fetch --depth 1 upstream "$DEF" 2>&1 | tail -1
git checkout -B "$BRANCH" "upstream/${DEF}"

if grep -q "$MARKER" README.md; then
  echo "Already listed in README — nothing to do."; exit 0
fi

python3 - "$ENTRY" "$SECTION_ANCHOR" <<'PY'
import sys, io
entry, anchor = sys.argv[1], sys.argv[2]
with io.open("README.md", encoding="utf-8") as f:
    lines = f.read().split("\n")
# find the first category header that comes AFTER the Security section
hdr = next(i for i, l in enumerate(lines) if anchor in l and l.startswith("### "))
# walk back to the last Security entry line ("- [")
j = hdr - 1
while j > 0 and not lines[j].startswith("- ["):
    j -= 1
assert lines[j].startswith("- ["), "could not locate last Security entry"
lines.insert(j + 1, entry)
with io.open("README.md", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print(f"inserted after line {j+1} (last Security entry)")
PY

git add README.md
git -c user.name="rezearcher" -c user.email="contact@greyridgesignals.ai" \
    commit -m "Add Grey Ridge x402 security scanner to Security

MCP server offering pre-trust safety checks for agents on Base: static
tool-poisoning/prompt-injection scanning (OWASP LLM01/LLM08), ERC-20
token-safety and honeypot detection, and swap preflight with an
allow/hold/block decision, billed per call over x402." 2>&1 | tail -2

git push -u "https://x-access-token:${TOK}@github.com/${FORK}.git" "$BRANCH" --force 2>&1 | tail -2

gh pr create --repo "$UPSTREAM" --head "rezearcher:${BRANCH}" --base "$DEF" \
  --title "Add Grey Ridge x402 security scanner (Security)" \
  --body "Adding **Grey Ridge Signals — x402 data & security API** to the **Security** category.

It is a remote MCP server (hosted, TypeScript) that gives agents pre-trust safety checks on Base, billed per call over x402:

- static MCP tool-poisoning / prompt-injection scan (OWASP LLM01/LLM08)
- ERC-20 token-safety and honeypot detection
- swap preflight that returns an allow / hold / block decision

Repo: https://github.com/rezearcher/x402-data-api — live MCP endpoint: https://x402-data-api.sigrunner.workers.dev/mcp

Single-line addition to the Security section; alphabetical order isn't enforced there, so it's appended as the last entry to keep the diff minimal."

echo "=== PR submitted ==="
gh pr list --repo "$UPSTREAM" --author rezearcher --state open --json url --jq '.[].url'
