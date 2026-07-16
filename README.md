# x402 Data API

Cloudflare Worker selling security/enrichment data via the [x402 payment protocol](https://x402.org),
**live on Base mainnet** (`eip155:8453`), settling through the non-custodial
[xpay](https://facilitator.xpay.sh) facilitator (no Coinbase/CDP key required).
Paid calls land real USDC at the receiving wallet in `PAY_TO`.

**Deployed:** https://x402-data-api.sigrunner.workers.dev

## Endpoints

| Method | Path | Price | Description |
|--------|------|-------|-------------|
| GET | `/health` | free | Liveness check |
| GET | `/dns/:domain` | $0.01 USDC | A/AAAA/MX/NS/TXT via Cloudflare DoH |
| GET | `/whois/:domain` | $0.02 USDC | Registrar/created/expiry/registrant via RDAP |
| GET | `/enrich/tech-risk?domain=…` | $0.05 USDC | Tech-stack fingerprint + CVE mapping (NVD) + EPSS + CISA KEV — attack-surface risk |
| GET | `/enrich/domain?domain=…` | $0.01 USDC | Firmographic + tech-stack (crt.sh, RDAP, DoH, HTTP fingerprint) |
| POST | `/mcp` | free discovery / $0.05 per `tools/call` | MCP server exposing `enrich_tech_risk` as a paid tool |

All paid endpoints return **HTTP 402** with an x402 `payment-required` header (base64
JSON: network `eip155:8453`, real `payTo`, USDC asset, price) on unpaid requests.

## MCP server (`/mcp`)

Streamable-HTTP MCP endpoint. **Discovery is free, execution is paid** (method-aware x402 gate):
- `initialize` and `tools/list` → free (so agents can find the tool)
- `tools/call` for `enrich_tech_risk` → **402** unless a valid `X-PAYMENT` proof is attached

```bash
# discover (free)
curl -s -X POST $BASE/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# call without payment → 402
curl -i -X POST $BASE/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"enrich_tech_risk","arguments":{"domain":"example.com"}}}'
```

> **History:** the `tools/call` path originally shipped **without** a payment gate (served data
> free). Fixed 2026-07-08 — see the payment-gate logic in `src/index.ts` (the `/mcp` branch of
> the `app.use` middleware requires payment only when the JSON-RPC method is `tools/call`).

## Data sources (all free/keyless — $0 marginal cost)

NVD (CVEs), FIRST EPSS (scores), CISA KEV, crt.sh (CT logs), RDAP (WHOIS),
Cloudflare DoH (DNS). No paid APIs.

## Deploy

```bash
# CF token needs Workers scope (the Pages-only token in black-box/.env WILL fail):
export CLOUDFLARE_API_TOKEN=$(grep ^CF_WORKERS_TOKEN= ~/.hermes/.env | cut -d= -f2-)
npx wrangler deploy
```

Config lives in `wrangler.toml` (`[vars]` PAY_TO, NETWORK) and `src/index.ts`
(`NETWORK`, `FACILITATOR_URL`).

## Status (2026-07-08)

- ✅ Live on Base mainnet, payment-gated (HTTP + MCP), returning real CVE/EPSS/KEV data, collecting to the real wallet.
- ⚠️ **Settlement not yet proven end-to-end** — the 402 challenge is well-formed and payable, but no real signed-USDC → 200 round-trip has been tested.
- ⚠️ **Distribution incomplete** — listed on [402index](https://402index.io) (pending review); the owned next step is publishing the MCP server to the [Official MCP Registry](https://registry.modelcontextprotocol.io) (needs interactive `mcp-publisher login` or a classic PAT with `read:org`+`read:user` — a fine-grained token can't publish).
- First real dollar not yet earned (needs distribution + demand).

## Autonomy

This project is shot #1 of the `prospector` ring — an autonomous systemd-timed loop
(`~/.claude/scripts/prospector_routines.sh`, policy `~/.claude/skills/prospector-ring/SKILL.md`)
that generates → builds → distributes → measures → kills x402 revenue plays via the Hermes
kanban worker, bounded by the shared spend tripwire + `PAUSE_AUTOEXEC` kill-switch.
