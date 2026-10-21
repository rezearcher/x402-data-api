# nastech-agent — silent-403 conversion-killer fix (PR #164)

- **Date:** 2026-10-21
- **Repo:** nastechresearch/nastech-agent (NousResearch-powered agent, 9★, pushed TODAY 2026-10-21T10:03Z, Python)
- **How found:** `gh search code "greyridgesignals.ai"` → new consumer repo. Its `plugin-catalog/greyridge-token-safety.yaml` lists our token-safety skill but pins stale sha `d3586eb`.
- **Defect (measured):** loader `nastech_cli/plugins_cmd_git.py::_checkout_exact_revision` detaches at the **exact pinned sha**, not HEAD. At `d3586eb` the skill curls `https://api.greyridgesignals.ai/...` — the custom domain Cloudflare bot-challenges (**403 from datacenter ASNs** where hosted agents run). Agent gets 403 → safety check silently useless → no conversion. Same bug class fixed for upstream NousResearch/hermes-agent in cycle 44 (PR #142479).
- **Fix shipped:** PR https://github.com/nastechresearch/nastech-agent/pull/164 — bump pin `d3586eb`→`3a7848e` + align disclosure host to `x402-data-api.sigrunner.workers.dev`. +2/-2, 1 file, MERGEABLE/CLEAN.
- **Evidence (live, this cycle):**
  - diff `d3586eb...3a7848e` (greyridge-token-safety-skill) is URL-only: 2 curls `api.greyridgesignals.ai`→`workers.dev` + paid_url/llms.txt pointer.
  - `workers.dev /gate/swap/preview?token=0x8335...2913&side=buy&usd=100` → **200**
  - custom domain returned 200 from this WebFetch host (403 is ASN-intermittent — datacenter/GH-Actions ASNs get challenged).
- **Lever:** `nastech-agent-pr164-skill-403-sha-bump` (contacted->replied).
- **Status:** ball-in-court on nastech maintainer. Do NOT re-ping. Watch for merge.
- **Oracle:** wallet flat 33.01624 USDC (RPC read-failed; scoreboard authoritative). No external transfer.
