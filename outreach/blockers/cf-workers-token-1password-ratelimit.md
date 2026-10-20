# Blocker: scanner round-3 deploy needs CF_WORKERS_TOKEN (1Password rate-limited)
Why it matters: Miles (Liquid Logic X) will run /scan/mcp/preview this week; round 3 fixes false positives on clean servers. Committed + pushed, not live.
Steps for Rez:
1. `cd ~/projects/x402-data-api && source ~/.config/greyridge/op.env && CLOUDFLARE_API_TOKEN="$(op read op://Division/CF_WORKERS_TOKEN/credential)" bash scripts/deploy.sh`
   (or: wrangler login with an account that has Workers write; current OAuth login returns "No access to the specified service").
2. Verify: curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://alphabazaar.ai/mcp"
Background retry /tmp/retry_deploy.sh does this automatically if 1Password recovers.
