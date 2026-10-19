# Cloudflare zone 403s datacenter crawlers/agents on api.greyridgesignals.ai

Evidence 2026-10-19: Decixa's verifier (cloud IP) gets HTTP 403 on every https://api.greyridgesignals.ai/* route; same routes on x402-data-api.sigrunner.workers.dev return 402 to it. From a residential IP the custom domain returns 402. OpenDexter also reported `discovery_failed` on the api host. The 403 is not from our Worker code (no 403 path in src/index.ts) — it is the Cloudflare zone (Bot Fight Mode / Super Bot Fight / security level). Agent buyers and listing crawlers run on cloud IPs, so every listing that points at api.greyridgesignals.ai is likely unreachable to them.

Our CF API tokens lack zone-level permissions (auth error on rulesets/bot_management/settings), so only Rez can fix:

1. dash.cloudflare.com -> greyridgesignals.ai -> Security -> Bots: turn OFF "Bot Fight Mode" (or Super Bot Fight Mode: set Definitely automated + Verified bots = Allow).
2. Security -> Settings: Security Level = Essentially Off / Low.
3. Security -> WAF -> Custom rules: add rule "(http.host eq "api.greyridgesignals.ai")" -> Action: Skip (all remaining custom rules, rate limiting, Super Bot Fight Mode, managed rules).
4. Verify from any cloud box: curl -s -o /dev/null -w "%{http_code}" https://api.greyridgesignals.ai/chain/gas-price  (want 402).

Unlocks: Decixa/OpenDexter/x402 directories and cloud-hosted buyer agents can reach the paid routes at all. Interim: we point new listings at the workers.dev host.
