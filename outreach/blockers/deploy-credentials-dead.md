# BLOCKER (Rez atom): both deploy credentials are expired — a committed safety fix cannot go live

**Status as of 2026-10-22T02:18Z.** This is the single thing gating conversion of the warmest lead.

## Why it matters right now
DopamineDesk (Joshua Hernandez), our warmest pilot, ran our free previews and found a **real fail-open bug** in `/gate/swap`: for token ISLM (`0xCB7fc1b4F8FA0Ff6C1d1cFea03f20B5461c2FEd3`) with no verifiable WETH pool (`liquidity_usd: null`), the gate returned `decision: go` while Honeypot.is + GoPlus both flag it a honeypot (~$0.78 liquidity). He will not wire us behind his preflight until this is fixed **and he can retest the live endpoint**.

The fix is **written, committed, and correct** (commit `2017bd6`: no verifiable WETH-pool liquidity → `HOLD`, never `GO`). Verified correct by applying the rule to live token-report data (ISLM → HOLD buy/sell). **It is not live** because I cannot deploy — both credential rails are dead:

1. **GitHub PAT** (`GH_TOKEN`/`GITHUB_TOKEN`, `github_pat_11AIDHE...`) → `Bad credentials` (HTTP 401). No `git push` → the GH-Actions deploy workflow (`.github/workflows/deploy.yml`) never fires. 3 commits queued locally and unpushed (`2017bd6`, `43adfeb`, `f56da07`...).
2. **Cloudflare Wrangler OAuth** (`~/.wrangler/config/default.toml`) → access token expired 2026-07-31; manual refresh against `dash.cloudflare.com/oauth2/token` returns `invalid_grant` (refresh token revoked/expired). No `CLOUDFLARE_API_TOKEN` in env. `wrangler deploy` blocked.

Deploy needs EITHER rail working. Both are down.

## Exact steps for Rez (pick one — either unblocks deploy)
**Option A — refresh the GitHub PAT (also unblocks all GitHub outreach + listing PRs):**
1. Create a fine-grained PAT for `rezearcher` with **Contents: read/write** + **Pull requests: read/write** on `rezearcher/x402-data-api`.
2. Update the env the loop reads (where `GH_TOKEN`/`GITHUB_TOKEN` are set) with the new token.
3. Next cycle auto-runs `git push origin main` → GH Actions deploys the fix live.

**Option B — re-auth Cloudflare Wrangler (unblocks direct deploy without GitHub):**
1. In an interactive shell: `wrangler login` (or set `CLOUDFLARE_API_TOKEN` with `workers_scripts:write` for the account).
2. Next cycle can run `npx wrangler deploy` directly.

## After deploy (automatic next cycle, no Rez action)
- Re-verify live: `curl ".../gate/swap/preview?token=0xCB7fc1b4F8FA0Ff6C1d1cFea03f20B5461c2FEd3&side=buy&notional_usd=100"` must return `decision: hold`.
- Send Joshua the owed ONE-line "it's live, retest" note (event-gated follow-up tracked in `outreach/warm_leads.json`).
- That retest → wire `&ref=dopaminedesk` → first traceable external USDC.
