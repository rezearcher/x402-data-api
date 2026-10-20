# Blocker: scanner round-3 deploy needs CF_WORKERS_TOKEN (1Password rate-limited)
Why it matters: Miles (Liquid Logic X) will run /scan/mcp/preview this week; round 3 fixes false positives on clean servers. Committed + pushed, not live.
Steps for Rez:
1. `cd ~/projects/x402-data-api && source ~/.config/greyridge/op.env && CLOUDFLARE_API_TOKEN="$(op read op://Division/CF_WORKERS_TOKEN/credential)" bash scripts/deploy.sh`
   (or: wrangler login with an account that has Workers write; current OAuth login returns "No access to the specified service").
2. Verify: curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://alphabazaar.ai/mcp"
Background retry /tmp/retry_deploy.sh does this automatically if 1Password recovers.

## 2026-10-20 c90 — fastest fix (no 1Password needed)
The env token CF_API_TOKEN (id fa1b9941bd3697c79b50ae821c3034a1, account 9b5a408f…) is VALID for the right account but has NO Workers permission
(GET /workers/scripts/x402-data-api/settings -> "No access"). Fix in 30s:
1. https://dash.cloudflare.com/profile/api-tokens (or Manage Account > Account API Tokens) -> edit that token -> add Account > Workers Scripts > Edit (+ Workers KV Storage Edit, Durable Objects) -> Save. Token value unchanged, so the env var works immediately; next cycle deploys.
2. Optional: `gh secret set CLOUDFLARE_API_TOKEN` on rezearcher/x402-data-api -> .github/workflows/deploy.yml (added c90) deploys on every push to main, independent of 1Password.
Unlocks: TrafficLog DO read-cap fix (75ee84f) + trial 429 + scanner round-3 for Miles.
