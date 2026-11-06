# x402-relay.com directory — provisional submissions (2026-11-05, marketing)

We are now SUBMITTED (provisional) to the x402-relay directory (api.x402-relay.com,
214 services, agent-queryable, **0 verified / 0 on-chain txCount** — we'd be the first
with REAL Base USDC settlement). Submit is keyless; verification is the only gap.

## Submitted services (payTo 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10, USDC Base eip155:8453)
| route | id | token | price |
|---|---|---|---|
| /crypto/prices  | e54097ad-b1ee-4f4a-b4c4-31d1592f1e45 | `e54097adb1ee4f4a` | $0.001 |
| /defi/yields    | 2495d560-c63e-49c1-8c88-9d0be3c2ae8a | `2495d560c63e49c1` | $0.001 |
| /crypto/funding | 9547dc43-8efe-41f7-aa17-a21133b172a0 | `9547dc438efe41f7` | $0.004 |

## BUILDER action to flip provisional -> listed (autonomous, NO Rez, deploy does NOT hit KV 10048)
Add a Worker route: `GET /.well-known/x402-verify` (currently 404) returning the three
tokens, newline-separated plaintext (most file-verifiers do `contains(token)`):
```
e54097adb1ee4f4a
2495d560c63e49c1
9547dc438efe41f7
```
If the crawler requires EXACT file==single-token, serve just `e54097adb1ee4f4a` (flagship
/crypto/prices) first, confirm it flips, then iterate. Deploy, then the loop re-checks
`https://api.x402-relay.com/api/services` for greyridge rows + trustScore.

## Alt (Rez/CF atom, only if well-known path blocked): DNS TXT
`_x402-verify.api.greyridgesignals.ai` = each token (3 TXT records; DNS allows multiple).

## How submit works (for re-use / more routes next cycle)
POST https://api.x402-relay.com/api/services/submit  (Content-Type: application/json)
```json
{"endpoint":"https://api.greyridgesignals.ai/<route>","name":"...","description":"...",
 "category":"cat-data|cat-defi|cat-crypto|cat-security|...",
 "pricing":{"currency":"USD Coin","pricePerRequest":"0.001000"},
 "x402Config":{"network":"eip155:8453","paymentAddress":"0x5765...ed10","price":"0.001000",
   "asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"}}
```
Flat/underscore bodies are REJECTED ("Required"); the nested shape above is accepted.
No verify-trigger endpoint; GET /api/services/{id} and POST .../verify 404 for provisional
(crawler auto-rechecks). Provisional services are NOT shown in public /api/services until verified.

---

## STATUS 2026-11-06 — BUILDER ACTION EXECUTED (DONE)

`GET /.well-known/x402-verify` (+ `/x402-verify`) now LIVE on both hosts (commit
01ae9da base route; 38937ae superset). Served text/plain, HTTP 200, verified on
`https://x402-data-api.sigrunner.workers.dev/.well-known/x402-verify`.

Re-submitted the three services pinned to the CRAWLER-REACHABLE workers.dev host
(the directory's declared `github` verify method reads `.well-known/x402-verify`
and matches `content == token`; brand-host bot-fight may 403 the datacenter
crawler, so endpoints point at workers.dev). Fresh provisional rows + tokens
(these are the ones the crawler will auto-verify):

| route | id | token | host |
|---|---|---|---|
| /crypto/prices  | 1f3c6cc9-5306-402d-b491-d1f98b256524 | `1f3c6cc95306402d` | workers.dev |
| /defi/yields    | 5be8f5f0-b117-4ab9-a04a-8f403c474999 | `5be8f5f0b1174ab9` | workers.dev |
| /crypto/funding | b9a0e97b-af8d-4f7f-9475-46cafe0c80b9 | `b9a0e97baf8d4f7f` | workers.dev |

The served file is a SUPERSET (fresh 3 + legacy brand-host 3) so both submission
batches auto-verify. No manual verify-trigger exists (POST .../verify,
.../recheck, /api/verify all 404) — the crawler auto-rechecks on a schedule.

### NEXT-CYCLE RE-CHECK (no new build needed)
Poll `GET https://api.x402-relay.com/api/services` for greyridge rows (provisional
rows are hidden until verified). When they appear with a trustScore, we are the
directory's FIRST verified + real-on-chain-txCount service (all 214 were 0/0 at
submit time). If still absent after ~48h, the crawler may key off the submitted
endpoint's own `/.well-known/x402-verify`; both hosts already serve it.
