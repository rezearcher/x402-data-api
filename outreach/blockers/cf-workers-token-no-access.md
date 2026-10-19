# ✅ RESOLVED 2026-10-19 — CF_WORKERS_TOKEN now has Workers Scripts:Edit; deploy verified (version 5538b16d). Superseded by cf-workers-token-scope.md.
---
# Cloudflare Workers token can't deploy (found 2026-10-19 ~22:50Z)
Symptom: scripts/deploy.sh fails "Authentication error [code: 10000]". op://Division/CF_WORKERS_TOKEN verifies active, account 9b5a408f... is visible, but GET /accounts/<id>/workers/scripts returns an EMPTY list and /workers/services/x402-data-api returns "No access to the specified service" (same for CF_API_TOKEN). The rotated token has no Workers Scripts permission on the account that hosts the Worker.
Fix (Rez, ~2 min): dash.cloudflare.com/profile/api-tokens -> create token from "Edit Cloudflare Workers" template (Account: Workers Scripts:Edit, Workers KV Storage:Edit, Durable Objects if listed; account resources = Include the account hosting api.greyridgesignals.ai). Store: ~/.claude/skills/1password/scripts/rotate_secret.sh CF_WORKERS_TOKEN -
Why it unlocks money: no Worker redeploys (metadata/keyword fixes, new routes) are possible until fixed. Live API keeps serving meanwhile. Pending change: "token security" keyword in /gate/swap descriptions (src/index.ts:805,2459), uncommitted-deploy.

## UPDATE 2026-10-19 23:25Z (c3)
Token now authenticates: deploy.sh failed with Cloudflare 'Rate limited (10429)', NOT 'No access'. Blocker likely CLEARED. Just retry scripts/deploy.sh (twice, per new-route rule) every ~5 min until it passes; 0f0adb5 (preview fix) is waiting to ship.
