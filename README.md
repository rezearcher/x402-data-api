# Grey Ridge Signals — Agent-Native x402 Data & Security APIs

**Pay-per-call crypto, DeFi, prediction-market, and on-chain data for AI agents — plus MCP
security scanning — over the [x402 payment protocol](https://x402.org) on Base mainnet.**

No account, no API key, no subscription. An agent pays inline in USDC (from $0.001/call) and
gets the data back in the same request. Every data endpoint has a **free preview** so an agent
can taste the payload before paying.

- **Base URL:** `https://x402-data-api.sigrunner.workers.dev`
- **MCP endpoint (streamable-http):** `https://x402-data-api.sigrunner.workers.dev/mcp`
- **Discovery:** [`/.well-known/x402`](https://x402-data-api.sigrunner.workers.dev/.well-known/x402) · [`/openapi.json`](https://x402-data-api.sigrunner.workers.dev/openapi.json) · [`/llms.txt`](https://x402-data-api.sigrunner.workers.dev/llms.txt)
- **Network:** Base mainnet (`eip155:8453`), USDC. Settles via the non-custodial [xpay](https://facilitator.xpay.sh) facilitator — no Coinbase/CDP account needed. Also listed on the CDP x402 Bazaar.

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
| `GET /chain/code?address=` | $0.001 | Contract-code check (is it a contract?) |
| `GET /chain/wallet?address=` | $0.003 | **Bundle:** ETH balance + tx count + contract flag in one call |

### Security
| Endpoint | Price | Returns |
|---|---|---|
| `GET /scan/mcp?url=` | $0.10 | Security audit of a target MCP server: tool-poisoning / prompt-injection / exfiltration / dangerous-capability / hidden-unicode (OWASP LLM01/LLM08) + risk score |
| `GET /enrich/tech-risk?domain=` | $0.05 | Tech-stack fingerprint → CVE (NVD) + EPSS + CISA-KEV attack-surface risk |
| `GET /enrich/domain?domain=` | $0.01 | Firmographic + tech-stack enrichment (crt.sh, RDAP, DoH, HTTP fingerprint) |

Free previews: `GET /crypto/prices/preview`, `/crypto/funding/preview`, `/defi/yields/preview`, `/chain/block-number/preview`, `/chain/gas-price/preview` (full live data, not truncated), `/scan/mcp/preview?url=`.

---

## MCP server (the pull channel)

Add one remote MCP server and your agent gets the whole toolset. `initialize` and `tools/list`
are **free** so agents can discover the tools; paid `tools/call` returns an x402 challenge.

`tools/list` advertises 11 tools: `crypto_prices`, `crypto_funding`, `defi_yields`, `pm_markets`
(paid data), `crypto_prices_preview`, `crypto_funding_preview`, `defi_yields_preview` (free),
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

## How it runs

A single [Cloudflare Worker](./src/index.ts) implements every HTTP endpoint and the MCP server
behind a method-aware x402 gate. All upstreams are **free/keyless** public APIs (DefiLlama,
Hyperliquid, OKX, Polymarket Gamma, Base JSON-RPC, NVD/EPSS/CISA-KEV, crt.sh/RDAP/DoH); every
address/hash/domain input is validated and SSRF-guarded (fixed upstream hosts, no user-supplied
targets except the explicitly-scoped `/scan/mcp` and enrichment endpoints).

## License

MIT — see [LICENSE](./LICENSE).
