# Distribution state — what's live, what's staged (updated 2026-07-16 late)

Root cause of $0 (2-agent research): CDP Bazaar discovery is broken (semantic search returns 0;
0-call listings buried in a 25k tail; publish pipeline flaky). The fix = breadth + quality + the
**MCP pull channel** + getting onto **working-search** directories. Status below.

## DONE — live on 3 working discovery surfaces (all autonomous)
| Surface | State | Mechanism |
|---|---|---|
| **MCP Registry** | `io.github.rezearcher/tech-risk` v1.2.0, data-forward | `mcp-publisher login github --token $GH_TOKEN` (NON-interactive flag) → `mcp-publisher publish` |
| **402index.io** | 15 endpoints live, domain-verified | `POST https://402index.io/api/v1/register` (no auth); `/.well-known/402index-verify.txt` auto-verifies |
| **x402scan.com** | 15 endpoints registered (source: openapi) | `node register_x402scan.js` — SIWX wallet-sign to `POST /api/x402/registry/register-origin` |
| CDP Bazaar | 4 crypto listings (broken search) | `node seed_endpoint.js <route>` — deprioritized |
| Crawlable | `.well-known/x402`, `/openapi.json`, `/llms.txt` | served by the Worker |

Product: 15 paid endpoints (4 data + 8 Base RPC + 3 security), 11-tool MCP server, cross-venue
funding + decision-grade yields (differentiation = repeat callers). README rewritten data-forward.

## STAGED / capped (genuine limits, tested — not premature "walled")
- **awesome-x402 (xpaysh, 261★):** entry branch pushed (`rezearcher:add-grey-ridge-signals`).
  Cross-repo PR-open AND issue-open both return `Resource not accessible by personal access token`
  — fine-grained PAT can't write PRs/issues on repos we don't own. Opens with a classic token or a click.
- **Contact-email ownership verification (x402scan/402index):** would boost ranking/trust. We have a
  send-capable Grey Ridge address `kairos@sigrunner.com` (himalaya/SMTP) + Cloudflare `email_routing`/
  `email_sending` scopes on sigrunner.com — capability exists; a clean dedicated contact alias is the tidy way.

## The exogenous remainder
First **organic** dollar = a real external agent pays (on-chain verified $0: 31/31 inbound USDC to
payTo are our own wallets). Not fakeable, not forceable. Reachable faster only via APPROPRIATE outreach
(a welcome, targeted ask — brand-safety judgment, not mass cold-spam) or organic discovery on the
3 seeded working surfaces. Monitors (`x402_revenue_monitor`, `x402_bazaar_index_monitor`, `x402_selfheal`)
are armed to catch + compound the first real payer.
