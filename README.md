# Grey Ridge Signals — Agent-Native x402 Data & Security APIs

**Pay-per-call crypto, DeFi, prediction-market, and on-chain data for AI agents — plus MCP
security scanning — over the [x402 payment protocol](https://x402.org) on Base mainnet.**

No account, no API key, no subscription. An agent pays inline in USDC (from $0.001/call) and
gets the data back in the same request. Every data endpoint has a **free preview** so an agent
can taste the payload before paying.

- **Base URL:** `https://x402-data-api.sigrunner.workers.dev`
- **MCP endpoint (streamable-http):** `https://x402-data-api.sigrunner.workers.dev/mcp`
- **Canonical domain:** `https://x402-data-api.sigrunner.workers.dev` (same API)
- **Discovery:** [`/.well-known/x402`](https://x402-data-api.sigrunner.workers.dev/.well-known/x402) · [`/openapi.json`](https://x402-data-api.sigrunner.workers.dev/openapi.json) · [`/llms.txt`](https://x402-data-api.sigrunner.workers.dev/llms.txt)
- **Network:** Base mainnet (`eip155:8453`), USDC. Settles via the non-custodial [xpay](https://facilitator.xpay.sh) facilitator — no Coinbase/CDP account needed. Also listed on the CDP x402 Bazaar.

---

## Two flagships — what agents actually pay for

1. **MCP server security scan** (`/scan/mcp`, $0.05) — a prompt-injection / tool-poisoning audit of an MCP server's tools (OWASP LLM01/LLM08). **Zero-egress**: for private/OAuth-gated servers you POST only the `tools/list` JSON — nothing else leaves your side. *There is no free equivalent for this* (unlike token-safety, where free multi-chain scanners exist). Free preview: `POST /scan/mcp/preview`. CI gate: `uses: rezearcher/x402-data-api/actions/mcp-scan@main`.
2. **Pre-trade decision gate** (`/gate/swap`, $0.008 · `/chain/token-report`, $0.01) — a *decision* (GO/HOLD/BLOCK, SAFE/CAUTION/AVOID) sized to your trade, not raw flags your agent has to interpret. **Base-native**; if you trade other chains, keep your multi-chain scanner and use this on Base.

Everything below is the full catalog (crypto/DeFi data, on-chain reads, LLM, enrichment). Measured reliability at [`/status`](https://x402-data-api.sigrunner.workers.dev/status) (not an SLA).

---

## Endpoints

### Crypto & DeFi data
| Endpoint | Price | Returns |
|---|---|---|
| `GET /crypto/prices?coins=bitcoin,ethereum,solana` | $0.001 | Spot token prices (DefiLlama), keyless. Up to 25 CoinGecko ids. |
| `GET /crypto/funding?limit=20` | $0.001 | **Cross-venue** perp funding rates (Hyperliquid + OKX, graceful fallback) with the **funding spread** + best long/short venue — the arb signal, not just a single-venue list. |
| `GET /defi/yields?limit=20&project=&chain=&stable=` | $0.001 | Top DeFi lending/LP yields (DefiLlama) with APY breakdown, **7d/30d APY trend, IL risk, and DefiLlama's stability forecast** — decision-grade, not a raw list. |
| `GET /pm/markets?query=&limit=20` | $0.005 | Live Polymarket prediction markets: question, outcomes, prices, volume, liquidity, end date. |

### Base on-chain (JSON-RPC read primitives)
Base-native, multi-provider RPC with automatic failover (never fails a paid call on one provider's rate limit).

| Endpoint | Price | Returns |
|---|---|---|
| `GET /chain/block-number` | $0.001 | Current Base block number |
| `GET /chain/gas-price` | $0.001 | Current gas price (wei + gwei) |
| `GET /chain/balance?address=` | $0.001 | Native ETH balance |
| `GET /chain/token-balance?address=&token=` | $0.001 | ERC-20 token balance |
| `GET /chain/tx?hash=` | $0.001 | Transaction details |
| `GET /chain/receipt?hash=` | $0.001 | Transaction receipt (status, gas used, logs) |
| `GET /chain/code?address=` | $0.001 | Contract-code check — is it a contract, and **EIP-7702 delegated-EOA detection** (`is_eip7702_delegate` / `delegate_address`) |
| `GET /chain/wallet?address=` | $0.003 | **Bundle:** ETH balance + tx count + contract flag in one call, EIP-7702 delegated-EOA aware (`is_eip7702_delegate` / `delegate_address`) |

### Agent trading gates (new)
| Endpoint | Price | Returns |
|---|---|---|
| `GET /gate/swap?token=0x…&side=buy\|sell&notional_usd=N` | $0.008 | **Pre-trade go/hold/block decision** for any Base ERC-20: safety verdict, risk score, pool liquidity and price-impact of your size, flags. One call before an agent swaps. Free live sample: [`/gate/swap/preview`](https://x402-data-api.sigrunner.workers.dev/gate/swap/preview) |
| `GET /chain/token-report?token=0x…` | see `/openapi.json` | Full token due-diligence report (security + liquidity + metadata) in one call |

### Security
| Endpoint | Price | Returns |
|---|---|---|
| `GET /scan/mcp?url=` | $0.05 | Security audit of a target MCP server: tool-poisoning / prompt-injection / exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08) + risk score |
| `POST /scan/mcp` `{"tools":[…]}` | $0.05 | **Zero-egress** audit — paste your own `tools/list` array; same itemized findings, **nothing leaves your side** and we never fetch/call your server. For OAuth-gated or private MCP servers that won't expose a URL |
| `GET /enrich/tech-risk?domain=` | $0.05 | Tech-stack fingerprint → CVE (NVD) + EPSS + CISA-KEV attack-surface risk |
| `GET /enrich/domain?domain=` | $0.01 | Firmographic + tech-stack enrichment, incl. **full subdomain enumeration** (`subdomains[]`) via crt.sh certificate-transparency logs, RDAP, DoH, HTTP fingerprint |

Free previews: `GET /crypto/prices/preview`, `/crypto/funding/preview`, `/defi/yields/preview`, `/chain/block-number/preview`, `/chain/gas-price/preview` (full live data, not truncated), `/scan/mcp/preview?url=`. **Zero-egress MCP scan** (for private/OAuth-gated servers): `POST /scan/mcp/preview` with `{"tools":[…]}` is the free counts-only preview; `POST /scan/mcp` with the same body is the paid itemized scan — nothing leaves your side. One-liner: [`examples/mcp-scan-preview.sh`](examples/mcp-scan-preview.sh).

---

## MCP server (the pull channel)

Add one remote MCP server and your agent gets the whole toolset. `initialize` and `tools/list`
are **free** so agents can discover the tools; paid `tools/call` returns an x402 challenge.

`tools/list` advertises 22 tools: `crypto_prices`, `crypto_funding`, `defi_yields`, `pm_markets`,
`chain_block_number`, `chain_gas_price`, `chain_balance`, `chain_token_balance`, `chain_tx`,
`chain_wallet`, `chain_token_security` (paid Base RPC + data, EIP-7702 delegated-EOA aware),
`crypto_prices_preview`, `crypto_funding_preview`, `defi_yields_preview`, `pm_markets_preview`,
`chain_block_number_preview`, `chain_gas_price_preview`, `chain_token_security_preview` (free),
and `scan_mcp_server`, `scan_mcp_preview`, `enrich_tech_risk`, `enrich_domain` (security).

```jsonc
// add to your MCP client config
{
  "mcpServers": {
    "grey-ridge-x402": {
      "type": "streamable-http",
      "url": "https://x402-data-api.sigrunner.workers.dev/mcp"
    }
  }
}
```

## MCP client (`mcp-client/` — the stdio companion)

For stdio-only MCP clients (Claude Desktop, Cursor, CLI agents), the repo ships a
companion package, `x402-data-api-mcp`, in [`mcp-client/`](./mcp-client/). It runs on
the agent's own machine, speaks MCP over **stdio**, and proxies to the same Worker
`/mcp` endpoint — it adds no data surface, just a transport + x402 payment shim so
stdio-only clients can reach the same tools (22 tools, including paid ones when a
wallet key is configured).

**Install / run (local path).** The package is **not yet published to npm**, so run it
from the repo:

```bash
cd mcp-client
npm install
npm run build          # tsc → dist/server.js
node dist/server.js    # start (or: npm start)
```

**Intended path (once published):** `npx @grey-ridge/x402-data-api-mcp` (the package's `bin`
target is `dist/server.js`, so `npx` runs the same server).

**Configuration.** Copy [`mcp-client/.env.example`](./mcp-client/.env.example) to
`.env` in `mcp-client/`: `WORKER_BASE_URL` defaults to the deployed Worker (set it
only to point at your own mirror), and `X402_WALLET_PRIVATE_KEY` is optional — set it
to auto-settle paid tools (HTTP 402) via x402; leave it empty to run only the
free/preview tools. The client reads both straight from `process.env` at startup.

```jsonc
// stdio client config (local path)
{
  "mcpServers": {
    "grey-ridge-x402-local": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-client/dist/server.js"]
    }
  }
}
```

## Call it (HTTP)

```bash
BASE=https://x402-data-api.sigrunner.workers.dev

# free preview — real sample, no payment
curl -s "$BASE/crypto/funding/preview"

# paid — returns HTTP 402 with an x402 payment-required challenge until you attach payment
curl -i "$BASE/crypto/funding?limit=10"
```

Any x402-capable client (e.g. the [`x402`](https://www.npmjs.com/package/x402) libraries)
handles the 402 → sign → retry automatically.

## Measured status

Uptime and latency per safety route are measured from a probe cron and published in [docs/STATUS.md](docs/STATUS.md) (regenerated hourly; window stated in the file, not an SLA).

## How it runs

A single [Cloudflare Worker](./src/index.ts) implements every HTTP endpoint and the MCP server
behind a method-aware x402 gate. All upstreams are **free/keyless** public APIs (DefiLlama,
Hyperliquid, OKX, Polymarket Gamma, Base JSON-RPC, NVD/EPSS/CISA-KEV, crt.sh/RDAP/DoH); every
address/hash/domain input is validated and SSRF-guarded (fixed upstream hosts, no user-supplied
targets except the explicitly-scoped `/scan/mcp` and enrichment endpoints).

## License

MIT — see [LICENSE](./LICENSE).

## Agent-framework examples
Pre-trade token guard (`/gate/swap`, $0.008 USDC via x402 on Base). Free sample: `curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=degen"`
- Node: `docs/examples/swap-gate/gate.mjs`
- LangChain.js tool: `docs/examples/langchain/swapGuardTool.mjs`
- ElizaOS action: `docs/examples/elizaos/swapGuardAction.mjs`

Market-data buyer (for agents that buy a price and must not present stale data as real-time — the Decision402 pattern): `examples/market-data-decision-buyer.mjs`. Runs the full agentic loop — reads the live 402 quote, enforces a per-call USDC budget, proves the feed via the free preview, pays `/crypto/prices` ($0.001 on Base), then **rejects any row older than `MAX_AGE_SECONDS`**. Steps 1-3 run with zero npm installs: `node examples/market-data-decision-buyer.mjs bitcoin,ethereum`.

## Python / LangChain / CrewAI
`pip install "git+https://github.com/rezearcher/greyridge-x402-tools"` — `token_report()` and `swap_gate()` helpers (free preview by default, paid x402 mode optional) plus LangChain tools. Guides: https://rezearcher.github.io/greyridge-x402-tools/

## Try it on YOUR token, free
`curl "https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview?token=0xYourBaseToken"` returns the same full-depth report as the paid route ($0.01). `/gate/swap/preview?token=0x…` gives 3 free real-token GO/HOLD/BLOCK checks/day/IP.

Agent skill (drop-in SKILL.md for OpenClaw/Hermes-style agents): https://github.com/rezearcher/greyridge-token-safety-skill

## CI gate for MCP servers
`uses: rezearcher/x402-data-api/actions/mcp-scan@main` with `url:` or `tools-file:` runs the free MCP tool-poisoning preview in CI and fails on a `block` verdict. See `actions/mcp-scan/README.md`.

> Python note: the default `Python-urllib` User-Agent is rejected with 403 at the Cloudflare edge. Use `requests`/`httpx`, or set any custom `User-Agent` header.
