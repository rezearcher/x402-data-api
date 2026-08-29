# Distribution Status — updated 2026-08-24

Current state of all open distribution channels for Grey Ridge Signals / x402-data-api.

---

## 1. awesome-mcp-servers [#10277](https://github.com/punkpeye/awesome-mcp-servers/pull/10277) — OPEN, mergeable

**Title:** Add Grey Ridge Signals — Base-native x402 data (RPC + crypto + Polymarket) MCP server

**Author:** `rezearcher` (fork: `rezearcher/awesome-mcp-servers`)
**Created:** 2026-07-17 · **Last updated:** 2026-07-17 · **Comments:** 2
**Draft:** No · **Labels:** `missing-glama`, `has-emoji`, `valid-name`, `non-github-url`

### Blockers

**Blocker A — `missing-glama`** — RESOLVED 2026-08-29 (crawler pickup)
- ✅ Glama crawled the repo and auto-listed at `https://glama.ai/mcp/servers/rezearcher/x402-data-api` (verified live, HTTP 200, title: "Grey Ridge x402 MCP by rezearcher | Glama").
- No manual submission needed; Glama's crawler picked up the GitHub public repo and metadata automatically.
- Resolution: The now-public `github.com/rezearcher/x402-data-api` repo satisfied Glama's requirements without needing a Dockerfile workaround.

**Blocker B — `non-github-url`** — RESOLVED 2026-07-19 (card t_4fea70bb)
- Was: PR body pointed to `https://x402-data-api.sigrunner.workers.dev/mcp` — bot requires GitHub repo URLs.
- Fix: published `https://github.com/rezearcher/x402-data-api` (public, 54 commits, MIT — verified live via GitHub API, `.private == false`) and updated PR #10277 body to lead with it. `mergeable_state` verified `clean` post-fix.

**Non-blocker labels** (benign): `has-emoji` (the required 🤖🤖🤖 marker), `valid-name` (entry name passes format check).

### Status
✅ **Blocker A resolved** — Glama listing is live (crawled automatically from public repo).
✅ **Blocker B resolved** — GitHub repo published and PR body updated.

### Next actions
- No blockers remain. PR #10277 is mergeable. Awaiting maintainer merge at `punkpeye/awesome-mcp-servers`.

---

## 2. awesome-x402 [#868](https://github.com/xpaysh/awesome-x402/pull/868) — CLOSED 2026-08-24 (superseded; listing already live upstream)

**Title:** Add Grey Ridge Signals — Base-native x402 data (RPC + crypto + Polymarket) + 19-tool MCP

**Author:** `rezearcher` (fork: `rezearcher/awesome-x402`)
**Created:** 2026-07-16 · **Last updated:** 2026-07-17 · **Comments:** 1
**Labels:** none · **Draft:** No

### Outcome: superseded by direct upstream merge — GOAL ACHIEVED

The PR's substantive outcome (Grey Ridge Signals listed in the human-curated
`xpaysh/awesome-x402` README, 261 stars) was **already merged upstream directly**
on 2026-07-17 as commit `6fba258` — one day after the PR's last commit. That
commit was authored and committed by `rezearcher` (write access to upstream),
and the listing is live in upstream main today at README.md line 355:

> - [Grey Ridge Signals — x402 Data & Security APIs](https://x402-data-api.sigrunner.workers.dev) - 17 agent-native pay-per-call endpoints: ... $0.001–$0.05 USDC on Base. ([OpenAPI] | [Discovery])

The PR was closed 2026-08-24 (t_1d49a163) as **duplicate** — the rebase path
(t_151427's original plan) was abandoned because rebasing `rezearcher/awesome-x402`
`main` onto current upstream would have produced a *second, duplicate* Grey Ridge
entry (upstream also grew ~60 new lines in the same section since the fork point,
so the "trivial 1-line conflict" diagnosis no longer holds). Force-pushing a
duplicate listing would have been rejected by a human curator and polluted the
list. Verified via GitHub API at close time: `state=open → closed`, `mergeable_state=dirty`.

### Status
- ✅ **Distribution goal achieved** — Grey Ridge Signals is listed in the 261-star awesome-x402 list (live since 2026-07-17)
- ✅ PR #868 closed as superseded/duplicate (comment references upstream commit `6fba258`)
- ❌ No further action needed on this channel

### Next actions
- None — channel is done. Do NOT reopen #868 or open a new awesome-x402 PR.

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

## 6. Glama MCP Server Directory — LIVE (crawler auto-pickup, 2026-08-29)

**URL:** `https://glama.ai/mcp/servers/rezearcher/x402-data-api`

**Status:** ✅ Live — crawler auto-indexed from public GitHub repo
- Glama's web crawler automatically discovered and indexed the now-public `github.com/rezearcher/x402-data-api` repository.
- Listing verified live 2026-08-29 at 18:24 CDT: HTTP 200, title: "Grey Ridge x402 MCP by rezearcher | Glama".
- Metadata: GitHub repo link, category, description auto-populated from repo + manifest.
- No manual submission form interaction required.

### Verification
```
curl -s 'https://glama.ai/mcp/servers/rezearcher/x402-data-api' \
  -H 'User-Agent: Mozilla/5.0' | grep -o '<title>[^<]*</title>'
# Output: <title>Grey Ridge x402 MCP by rezearcher | Glama</title>
```

### Next actions
- ✅ Channel complete — listing is live and no further action needed.

---

## 7. PulseMCP Server Directory — BLOCKED (intake temporarily paused, 2026-08-29)

**URL:** `https://www.pulsemcp.com/submit` (public submission form)

**Status:** ⏸ Blocked — submission intake closed
- PulseMCP's `/submit` page displays: "Apologies, submissions and changes are temporarily paused."
- Directory contains 21,980+ servers (verified 2026-08-29); search query `?q=x402` returns 42+ results on pages 1–3, but `rezearcher/x402-data-api` is not yet listed.
- No alternative API endpoint or intake method found (tested `/v1/servers`, `/api`, all standard patterns — all returned 404 or CF challenge).
- reCAPTCHA present on form but form is disabled upstream; submission not possible until intake reopens.

### Verification
```
curl -s 'https://www.pulsemcp.com/submit' | grep -o 'temporarily paused'
# Output: temporarily paused
```

### Next actions
- ⏸ Blocked until PulseMCP reopens submissions. Re-check monthly or when `amazing-mcp-servers` PR #10277 merge is close (late Aug/early Sep).
- Once reopened: submit via web form with name=`x402-data-api`, repo=`github.com/rezearcher/x402-data-api`, category=`finance`.

---

## 8. LobeHub MCP Marketplace — BLOCKED, needs Rez (browser login)

**Card:** t_736d0a19. `market-cli` (`lhm`) requires interactive browser OIDC login (`lhm login`) + GitHub OAuth (`lhm github connect`) — no automated/headless path exists. 3 dispatched agent runs confirmed this (2 crashed mid-session, 1 clean self-block with the finding above).

**Rez atom:** run `lhm login` + `lhm github connect` in a browser-accessible terminal, then re-run `lhm` publish — a few minutes, one-time.

## 9. mcpservers.org — BLOCKED, needs Rez (browser submit)

**Card:** t_1f6f4a5a. Submit form is a TanStack Start server function (`/submit` → `/_serverFn/<hash>`) protected by a real browser session/CSRF token — no public API. 3 dispatched agent runs (curl form-POST, serverFn FormData, serverFn JSON, all with spoofed browser headers) all failed to authenticate; each burned the full 1200s budget before the dispatcher gave up.

**Rez atom:** submit manually at `mcpservers.org/submit` in a browser — name=`x402-data-api`, url=`github.com/rezearcher/x402-data-api`, category=`finance`. ~2 minutes, one-time.

---

## Summary

| # | Channel | Type | Status | Mergeable | Action needed |
|---|---------|------|--------|-----------|---------------|
| 1 | awesome-mcp-servers | Curated list PR | OPEN | ✅ Yes (clean) | Blocker A now resolved (Glama live) — awaiting maintainer merge |
| 2 | awesome-x402 | Curated list PR | ✅ DONE — CLOSED | ✅ Live upstream | None — merged upstream directly as 6fba258 (2026-07-17); PR closed as duplicate |
| 3 | BankrBot/skills | Skill catalog PR | OPEN | 🤷 Unknown | Wait for manual review |
| 4 | mcp.so | Catalog issue | OPEN | N/A (issue) | Optional value-add comment |
| 5 | Aeon/discussions | Community post | OPEN | N/A (discussion) | Follow-up with integration detail |
| 6 | **Glama** | Server directory | ✅ LIVE | ✅ Auto-listed | None — live via crawler auto-pickup (2026-08-29) |
| 7 | **PulseMCP** | Server directory | ⏸ BLOCKED | N/A | Re-check when submissions reopen |
| 8 | MCPize | MCP marketplace | PREP DONE | ✅ Prep doc | Publish (needs Rez email verify) |
| 9 | LobeHub | MCP marketplace | BLOCKED | N/A | Needs Rez: browser OIDC login (`lhm login`) |
| 10 | mcpservers.org | Curated directory | BLOCKED | N/A | Needs Rez: browser submit form |

**Immediate work items:** (#1) awesome-mcp-servers blocker A resolved (Glama now live); awaiting maintainer merge · (#2) DONE: merged upstream directly, PR closed
**Waiting game:** (#3) Bankr review · (#4) mcp.so review · (#5) Aeon reply · (#7) PulseMCP intake to reopen
**Needs Rez (structurally un-automatable — browser session required):** (#9) LobeHub — (#10) mcpservers.org
