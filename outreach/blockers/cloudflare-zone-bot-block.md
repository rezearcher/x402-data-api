# P0: Cloudflare zone challenges (403) every datacenter IP on api.greyridgesignals.ai

RE-VERIFIED 2026-10-20T04:23Z from a GitHub Actions runner (Azure IP): `https://api.greyridgesignals.ai/*` -> HTTP 403,
`cf-mitigated: challenge`. The same route on `x402-data-api.sigrunner.workers.dev` -> 200/402. Home IP gets 402.
Consequence: every cloud-hosted buyer agent, registry bot (punkpeye auth-check read it as 401/403) and x402 verifier
sees an unreachable API on the custom domain. All our tokens lack zone permissions (9109 / 10000 on settings + rulesets).

Interim (done): all public listings/docs/examples/registry entries now point at the workers.dev host.

Permanent fix (2 min, Rez only) — dash.cloudflare.com -> greyridgesignals.ai:
1. Security -> WAF -> Custom rules -> Create rule: expression `(http.host eq "api.greyridgesignals.ai")`, action **Skip**
   (all remaining custom rules, rate limiting, managed rules, Super Bot Fight Mode, Bot Fight Mode). Deploy.
2. Security -> Bots: turn off Bot Fight Mode (if shown).
3. Verify from any cloud box: `curl -s -o /dev/null -w "%{http_code}" https://api.greyridgesignals.ai/chain/gas-price` -> 402.
Alternative: create a Cloudflare API token with Zone:Zone Settings:Edit + Zone:WAF:Edit (+ Zone:Bot Management) on this zone, store as op://Division/CF_ZONE_TOKEN/credential.
