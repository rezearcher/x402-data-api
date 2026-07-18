# Distribution Status — 2026-07-18

Current state of all 5 open distribution channels for Grey Ridge Signals / x402-data-api.

---

## 1. awesome-mcp-servers [#10277](https://github.com/punkpeye/awesome-mcp-servers/pull/10277) — OPEN, mergeable

**Title:** Add Grey Ridge Signals — Base-native x402 data (RPC + crypto + Polymarket) MCP server

**Author:** `rezearcher` (fork: `rezearcher/awesome-mcp-servers`)
**Created:** 2026-07-17 · **Last updated:** 2026-07-17 · **Comments:** 2
**Draft:** No · **Labels:** `missing-glama`, `has-emoji`, `valid-name`, `non-github-url`

### Blockers

**Blocker A — `missing-glama`**
- Bot requires the server to be listed on [Glama.ai](https://glama.ai/mcp/servers) and pass checks (Dockerfile needed for startup + introspection).
- Our server is a Cloudflare Worker (`streamable-http`, not a Docker container). Need to investigate whether Glama supports remote MCP servers or requires Docker-only.
- Workaround: package the MCP endpoint inside a minimal Dockerfile that wraps a proxy/health-check, or find if Glama accepts `streamable-http` remotes natively.

**Blocker B — `non-github-url`**
- PR body points to `https://x402-data-api.sigrunner.workers.dev/mcp` — bot requires GitHub repo URLs.
- Fix: update the PR body so the primary link references a GitHub repo (e.g. `https://github.com/rezearcher/mcp-security-scanner`). The Worker URL can remain as the MCP endpoint but the "source" link must be GitHub.

**Non-blocker labels** (benign): `has-emoji` (the required 🤖🤖🤖 marker), `valid-name` (entry name passes format check).

### Next actions
1. Investigate Glama remote-server support → resolve or add Dockerfile workaround
2. Re-open PR with body updated to use GitHub repo URL as primary link
3. Add Glama badge once listed

---

## 2. awesome-x402 [#868](https://github.com/xpaysh/awesome-x402/pull/868) — OPEN, BLOCKED (merge conflict)

**Title:** Add Grey Ridge Signals — Base-native x402 data (RPC + crypto + Polymarket) + 19-tool MCP

**Author:** `rezearcher` (fork: `rezearcher/awesome-x402`)
**Created:** 2026-07-16 · **Last updated:** 2026-07-17 · **Comments:** 0
**Labels:** none · **Draft:** No

### Blocker

**`mergeable_state: dirty`** — merge conflict with `xpaysh/awesome-x402` main branch.
- Single file changed: `README.md` (+1/-0 line)
- Conflict arises because the base repo's README was updated after the PR fork point.
- 2 commits on the PR branch: initial add + reframe to Base-RPC-first.

### Resolution
Rebase onto upstream main and resolve the trivial conflict:

```bash
git remote add upstream git@github.com:xpaysh/awesome-x402.git
git fetch upstream
git rebase upstream/main
# resolve README.md conflict (likely just applying the +1 line)
git push --force-with-lease origin main
```

### Next actions
1. Rebase onto upstream/main
2. Resolve README.md merge conflict
3. Force-push to update PR
4. Monitor for maintainer review

---

## 3. BankrBot/skills [#573](https://github.com/BankrBot/skills/pull/573) — OPEN (no visible blockers)

**Title:** Add grey-ridge-x402 skill — Base-native x402 data (RPC + USD + crypto + Polymarket)

**Author:** `rezearcher` (fork: `rezearcher/skills`)
**Created:** 2026-07-17 · **Last updated:** 2026-07-17 · **Comments:** 0
**Labels:** none · **Draft:** No

### Status
- `mergeable_state: unknown` — typical for PRs where the target repo doesn't expose mergeability via the API (e.g. private actions or review-only workflow).
- No bot checks, no labels, no comments.
- merge_commit_sha present but PR not merged — likely pending manual review by Bankr team.

### Assessment
This is a clean PR with no automated blockers. The delay is purely on the maintainer side (manual review queue). No PR action needed — just waiting.

### Next actions
- Wait for Bankr team review (they may have their own CI/review pipeline not visible to the API).
- Optional: gentle nudge after 1 week via a comment with a value-add (e.g. "noticed a new Polymarket agent pack — the `/pm/markets` endpoint might pair well with it").

---

## 4. mcp.so [#3190](https://github.com/chatmcp/mcpso/issues/3190) — OPEN (issue, not PR; no engagement)

**Title:** Add server: Grey Ridge Signals — Base-native x402 data (remote/hosted, 20-tool MCP)

**Created:** 2026-07-17 · **Last updated:** 2026-07-17 · **Comments:** 0

### Status
- This is a **GitHub Issue** (not a PR) — the mcp.so team manually adds servers to their catalog.
- 0 comments from maintainers — no engagement yet.

### Assessment
Standard listing request. mcp.so likely has a batch process for reviewing/new server additions. No action until they reply.

### Next actions
- No PR to fix — can optionally add a value-add comment with updated info (20 tools live, Base-native positioning) to increase interest.

---

## 5. Aeon/discussions [#745](https://github.com/aeonfun/aeon/discussions/745) — OPEN (discussion, 0 replies)

**Title:** Base-native x402 data source for Aeon — RPC + USD + Polymarket (/bin/bash.001/call, MCP one-liner)

**Created:** 2026-07-17 · **Last updated:** 2026-07-17 · **Comments:** 0

### Status
- Discussion post in Aeon's Show-and-tell with 0 replies.
- No maintainer engagement to date.

### Assessment
The discussion is well-crafted with technical depth, but it's easy to blend into the noise in a general showcase category. Aeon's maintainer (aaronjmars) is a solo builder — response times may vary.

### Next actions
- Consider a follow-up comment adding more detail: specific Aeon integration example, how `/pm/markets` maps to Aeon's Polymarket skill pack, or a curl demo.
- Could cross-reference the Aeon repo's existing x402 patterns to make integration more concrete.

---

## Summary

| # | Channel | Type | Status | Mergeable | Action needed |
|---|---------|------|--------|-----------|---------------|
| 1 | awesome-mcp-servers | Curated list PR | OPEN | ✅ Yes | Fix Glama listing + repo URL in body |
| 2 | awesome-x402 | Curated list PR | OPEN, CONFLICT | ❌ Dirty | Rebase + resolve README conflict |
| 3 | BankrBot/skills | Skill catalog PR | OPEN | 🤷 Unknown | Wait for manual review |
| 4 | mcp.so | Catalog issue | OPEN | N/A (issue) | Optional value-add comment |
| 5 | Aeon/discussions | Community post | OPEN | N/A (discussion) | Follow-up with integration detail |

**Immediate work items:** (#1) fix Glama + repo URL — (#2) rebase and fix merge conflict
**Waiting game:** (#3) Bankr review — (#4) mcp.so review — (#5) Aeon reply
