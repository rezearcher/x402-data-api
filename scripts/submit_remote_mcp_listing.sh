#!/usr/bin/env bash
# Grey Ridge — submit the Security listing to punkpeye/awesome-remote-mcp-servers.
#
# This is the CORRECT list for our hosted server: punkpeye split remote/hosted
# MCP servers out of the main awesome-mcp-servers into this one (he closed our
# earlier main-list PR #10277 with exactly that reason). This list accepts
# live endpoint URLs (workers.dev is fine) and x402-paid servers (see the
# existing `crosscheck` entry). High-authority dofollow backlink + human
# discovery for the scanner pages (measured 0 crawl hits/30d).
#
# Idempotent: re-running after the PR exists is a no-op.
#   GH_TOKEN=<token> bash scripts/submit_remote_mcp_listing.sh
set -euo pipefail

UPSTREAM="punkpeye/awesome-remote-mcp-servers"
FORK="rezearcher/awesome-remote-mcp-servers"
BRANCH="add-grey-ridge-security-scanner"
MARKER='io.github.rezearcher/tech-risk'

cd "$(dirname "$0")/.."

TOK="$(bash scripts/gh_token.sh 2>/dev/null || true)"
[ -z "$TOK" ] && TOK="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOK" ]; then
  echo "FATAL: no GitHub token." >&2; exit 1
fi
export GH_TOKEN="$TOK"

if gh pr list --repo "$UPSTREAM" --author rezearcher --state all --json url,state \
     --jq '.[] | "\(.state) \(.url)"' 2>/dev/null | grep -q .; then
  echo "A PR from rezearcher already exists on $UPSTREAM:"
  gh pr list --repo "$UPSTREAM" --author rezearcher --state all --json url,state --jq '.[] | "\(.state) \(.url)"'
  exit 0
fi

gh repo fork "$UPSTREAM" --clone=false 2>/dev/null || true
sleep 3

WORK="$(mktemp -d /tmp/arms_pr.XXXXXX)"
git clone --depth 1 "https://x-access-token:${TOK}@github.com/${FORK}.git" "$WORK/repo" 2>&1 | tail -1
cd "$WORK/repo"
DEF="$(gh repo view "$UPSTREAM" --json defaultBranchRef --jq '.defaultBranchRef.name')"
git remote add upstream "https://github.com/${UPSTREAM}.git"
git fetch --depth 1 upstream "$DEF" 2>&1 | tail -1
git checkout -B "$BRANCH" "upstream/${DEF}"

if grep -q "$MARKER" README.md; then
  echo "Already listed in README — nothing to do."; exit 0
fi

python3 - <<'PY'
import io
NAME = "Grey Ridge Signals"
L1 = "- [Grey Ridge Signals](https://x402-data-api.sigrunner.workers.dev/scan/directory) `https://x402-data-api.sigrunner.workers.dev/mcp`"
L2 = "  [![Grey Ridge Signals MCP connector](https://glama.ai/mcp/connectors/io.github.rezearcher/tech-risk/badges/score.svg)](https://glama.ai/mcp/connectors/io.github.rezearcher/tech-risk)"
L3 = "  \U0001F513 - Static MCP tool-poisoning and prompt-injection scanning (OWASP LLM01/LLM08), ERC-20 token-safety and honeypot detection, and swap preflight returning an allow, hold or block decision."

with io.open("README.md", encoding="utf-8") as f:
    lines = f.read().split("\n")

# locate the Security section header and the following "### " header
start = next(i for i, l in enumerate(lines) if '<a name="security">' in l and l.startswith("### "))
end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("### "))

# within [start,end), insert alphabetically before the first top-level entry
# whose display name sorts after ours (case-insensitive)
def entry_name(line):
    # "- [Name](...)" -> "name"
    return line[line.index("[") + 1 : line.index("]")].strip().lower()

insert_at = end  # default: append at section end
for i in range(start + 1, end):
    l = lines[i]
    if l.startswith("- ["):
        if entry_name(l) > NAME.lower():
            insert_at = i
            break

lines[insert_at:insert_at] = [L1, L2, L3]
with io.open("README.md", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print(f"inserted 3-line entry at line {insert_at+1} (Security section {start+1}-{end})")
PY

git add README.md
git -c user.name="rezearcher" -c user.email="contact@greyridgesignals.ai" \
    commit -m "Add Grey Ridge Signals to Security

A remote MCP server offering pre-trust safety checks for AI agents:
static tool-poisoning and prompt-injection scanning (OWASP LLM01/LLM08),
ERC-20 token-safety and honeypot detection, and a swap preflight that
returns an allow / hold / block decision." 2>&1 | tail -2

git push -u "https://x-access-token:${TOK}@github.com/${FORK}.git" "$BRANCH" --force 2>&1 | tail -2

gh pr create --repo "$UPSTREAM" --head "rezearcher:${BRANCH}" --base "$DEF" \
  --title "Add Grey Ridge Signals (Security)" \
  --body "Adding **Grey Ridge Signals** to the **Security** category.

It is a hosted MCP server (streamable HTTP) that gives AI agents pre-trust safety checks before they act:

- static MCP tool-poisoning / prompt-injection scanning (OWASP LLM01/LLM08)
- ERC-20 token-safety and honeypot detection
- swap preflight that returns an allow / hold / block decision

Free preview tools are callable anonymously; deeper checks are billed per call over x402 on Base.

- Endpoint: \`https://x402-data-api.sigrunner.workers.dev/mcp\`
- Glama connector (scored & healthy): https://glama.ai/mcp/connectors/io.github.rezearcher/tech-risk

Single alphabetical entry; happy to adjust formatting if you'd like anything changed."

echo "=== PR submitted ==="
gh pr list --repo "$UPSTREAM" --author rezearcher --state open --json url --jq '.[].url'
