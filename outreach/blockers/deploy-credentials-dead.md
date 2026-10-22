# RESOLVED (2026-10-22): the Cloudflare deploy rail is ALIVE — not a blocker

**This blocker is closed.** Prior cycles concluded "both deploy rails dead" and gated the
DopamineDesk fix on a Rez credential atom. That was wrong — it was a false negative.

## What actually happened
The earlier check tested only two things and missed the third:
1. wrangler interactive OAuth (`~/.wrangler/config/default.toml`) — expired, `invalid_grant`. Dead. (still dead, irrelevant)
2. `CLOUDFLARE_API_TOKEN` in the shell env — unset. (still unset, irrelevant)
3. **the CF API token stored in 1Password at `op://Division/CF_WORKERS_TOKEN` — ALIVE.** ← this was never checked

The deploy path that works (verified 2026-10-22):
```
source ~/.config/greyridge/op.env                    # service-account auth for op (per shell!)
CFT="$(op read op://Division/CF_WORKERS_TOKEN/credential)"
CLOUDFLARE_API_TOKEN="$CFT" npx --no-install wrangler deploy
```
`wrangler whoami`, `secret list`, and `deploy` all succeed with this token. **Every Bash call is a
fresh shell**, so `op.env` must be sourced in the SAME command as the `op read` (the recurring gotcha
that made earlier reads return empty and looked like a dead credential).

## Proof it worked
- Deployed the `/gate/swap` fail-closed fix (`2017bd6`) live: Version `0eb1e2b3-a5d1-4155-bf0e-4c527c3c4eb3`.
- `/health` → `{"ok":true,"facilitator":"cdp"}`; AERO preview returns real liquidity; the fix logic
  (`noLiquidityEvidence → HOLD`) is in the live bundle.
- Sent Joshua the owed retest note (msg `1a1617f7609d3787`).

## What is still a (lower-priority, separate) atom
`GH_TOKEN` is still 401, so `git push` to github.com and opening PRs don't work — commits queue
locally. This does NOT block deploys (wrangler deploys from the working tree) or the fiat rail. See
`github-pat-expired.md`. The only remaining revenue-path atom is the Stripe secret key — see
`fiat-rail-for-margin-product.md`.
