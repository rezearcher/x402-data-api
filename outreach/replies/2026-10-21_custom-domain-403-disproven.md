# 2026-10-21 — custom-domain "403 conversion killer" premise DISPROVEN (measured)

**Gate:** lane A, contacted->replied (improve targeting). Cold forbidden (144 pulls).

## What I measured
Tested the premise behind recent cycles' stale-pin wire-PRs + surface repointing:
"api.greyridgesignals.ai 403s datacenter ASNs where agents run."
- Sandbox datacenter host: GET / , /.well-known/x402 , /gate/swap/preview , /chain/token-report/preview  → **all HTTP 200**.
- web-fetch agent (independent datacenter vantage): /gate/swap/preview → **HTTP 200**, JSON verdict:SAFE, no Cloudflare challenge.
→ Custom domain does NOT 403 from these datacenter ASNs. Premise contradicted.

Caveat: original claim cited GitHub Actions runner IPs specifically; could not
retest from Actions (OAuth token lacks `workflow` scope — see blocker). But 2
real datacenter vantages serve 200.

## Action taken (committed 5750585)
Re-gated `consumer_stale_pin_sensor.py` on MEASURED domain health, not the
assumed 403. It now probes the domain live; stale pins reclassify to
STALE_PIN_BUT_DOMAIN_OK when it serves 200. n_targets 1→0, alert True→False.
Stops the loop generating token-safety (free-commodity) sha-bump PRs against a
phantom blocker. Evidence: data/evidence/custom_domain_probe_2026-10-21.json.

## Replies swept — all ball-in-court (no re-ping)
- adexto 0xcuy #4/#5: replied 10-20 "interesting shape… we'll evaluate", I gave
  drop-in curl + PR #5. Fully in their court.
- Market note: agent402.tools (sellers_lookup census) = cheaper compute rival
  ($0.001 vs our $0.002), 531 txns / $4512 vol → compute-lane demand is REAL but
  we're 2x price; our edge is fallback/reliability (adexto's exact angle), not price.
