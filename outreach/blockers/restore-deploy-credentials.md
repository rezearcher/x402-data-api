# BLOCKER: deploy credentials unavailable this session (rotated/wiped)

**Date:** 2026-10-22
**Impact:** A verified, committed fix (commit `fe4679c`) cannot be deployed. It is the
agentic.market enrichment fix (emits `resource.iconUrl` on every x402 route so the
Coinbase x402 directory — 480k+ transacting agents — enriches our Bazaar entry into a
browsable service card instead of showing us as the bare `workers.dev` domain with
`enriched:false`). Code is correct: `tsc` clean, 44/44 tests pass, mechanism verified
against `@x402/core` (`server/index.js:1988` copies `routeConfig.iconUrl` into the
resource), icon URL is live (`/miniapp/icon.png`, HTTP 200 image/png).

## Why it's blocked
Every deploy path needs a credential that is empty/invalid in this session:
- `~/.git-credentials` — **0 bytes** (was the rezearcher PAT; wiped today ~15:59). → `git push` fails.
- `~/.hermes/.env` — **0 bytes** (held `CF_WORKERS_TOKEN`). → `wrangler deploy` has no token.
- `GH_TOKEN` env var — set to a **stale/invalid** value (shadows everything).
- 1Password CLI — **not signed in** (`op whoami` → no account). The real PAT lives at
  `op://Division/GH_TOKEN_CLASSIC`; CF token normally reachable via op too.
- `wrangler whoami` — OAuth token expired, non-interactive refresh impossible.
- GitHub SSH — keys present but `Permission denied (publickey)`.

## Exact fix for Rez (any ONE of these ships it)
1. **Restore the git PAT** (fastest): put the rezearcher classic PAT back into
   `~/.git-credentials` as `https://x-access-token:<PAT>@github.com` (one line), then the
   loop's `git push origin main` triggers CI `deploy.yml` (repo secret `CF_WORKERS_TOKEN`)
   which deploys automatically. OR
2. **Sign in 1Password CLI** (`op signin` / enable desktop app integration) so
   `scripts/gh_token.sh` resolves `op://Division/GH_TOKEN_CLASSIC` again — restores both
   git push and (if stored) the CF token for every future cycle. OR
3. **Repopulate `CF_WORKERS_TOKEN`** in `~/.hermes/.env`, then the loop runs
   `bash scripts/deploy.sh` for a direct `wrangler deploy` (no GitHub needed).

Also unset the bad ambient `GH_TOKEN` (it shadows a valid 93-char PAT that `gh auth token`
already holds; `env -u GH_TOKEN gh ...` works, but the stored gh token lacks git-push scope).

## State left ready
- Commit `fe4679c` is on local `main`, ahead of origin by 1. Pushing it is all that's needed.
- No code review required — minimal additive change (9 lines), tests green.
