# BLOCKER: GitHub PAT expired (env GH_TOKEN / GITHUB_TOKEN = 401)

**Detected:** 2026-10-21 (cycle, this batch)
**Impact:** blocks `git push`, authenticated GitHub API (PR/issue reads via `gh`),
and any reply to a warm lead that responds on a GitHub thread. Unauthenticated
public REST reads still work (used them to confirm PR #14/#19/#9 states this cycle).

**Evidence:**
- `gh auth status` → "The token in GH_TOKEN is invalid."
- `curl -H "Authorization: bearer $GH_TOKEN" https://api.github.com/user` → HTTP 401
- Both `GH_TOKEN` and `GITHUB_TOKEN` are the SAME `github_pat_11AIDHE...` PAT, both 401.
- `git push origin main` → "remote: invalid credentials".

**What is NOT lost:** commit 2c6f6a4 (economist finding) is committed locally and
durable on disk; registries persist in `~/.hermes/data/x402_margin/`. Nothing was
dropped — it simply has not reached GitHub.

**ATOM (Rez only — needs your account):** regenerate the fine-grained PAT
(scopes: repo contents read/write + pull-requests, for rezearcher) and update the
env the loop reads (where GH_TOKEN/GITHUB_TOKEN are exported for these sessions).
Until then every cycle's commits queue locally and push on the next cycle after refresh.

**Auto-recovery:** if the PAT auto-rotates between cycles, the next cycle's first
`git push` will flush 2c6f6a4 + any queued commits. No action needed in that case.
