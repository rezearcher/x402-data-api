# x402-data-api-mcp

MCP stdio server for the [x402-data-api](https://x402-data-api.sigrunner.workers.dev) Worker. Exposes 22 tools covering blockchain data, crypto prices, DeFi yields, prediction markets, and enrichment endpoints via the [Model Context Protocol](https://modelcontextprotocol.io).

## Quick start

```bash
# Install
npm install -g x402-data-api-mcp

# Run for free/preview tools (no wallet needed)
x402-data-api-mcp

# Run with x402 wallet for paid tools (auto-settles HTTP 402)
X402_WALLET_PRIVATE_KEY=0x... x402-data-api-mcp
```

Or run directly from the repo:

```bash
npx x402-data-api-mcp
```

## Setup

1. Create `.env` from the template in this directory:

   ```bash
   cp .env.example .env
   ```

   Then configure:
   - `WORKER_BASE_URL` — defaults to `https://x402-data-api.sigrunner.workers.dev`
   - `X402_WALLET_PRIVATE_KEY` — optional, enables paid tool auto-settlement.
     The wallet address is derived from this key; there is no separate
     wallet-address variable.

2. Run your MCP client against `x402-data-api-mcp` as an stdio transport.

## Tools

All 22 tools proxied to the live Worker's MCP endpoint:

| Tool | Description | Category |
|---|---|---|
| `enrich_tech_risk` | Technical risk analysis for tokens | Enrichment |
| `enrich_domain` | Domain / WHOIS enrichment | Enrichment |
| `scan_mcp_server` | Full MCP server scanning (paid) | MCP |
| `scan_mcp_preview` | MCP server scanning (free preview) | MCP |
| `crypto_prices` | Live crypto prices (paid) | Crypto |
| `crypto_funding` | Funding rates (paid) | Crypto |
| `defi_yields` | DeFi yield rates (paid) | DeFi |
| `pm_markets` | Prediction market data (paid) | Prediction Markets |
| `crypto_prices_preview` | Live crypto prices (free) | Crypto |
| `crypto_funding_preview` | Funding rates (free) | Crypto |
| `defi_yields_preview` | DeFi yield rates (free) | DeFi |
| `pm_markets_preview` | Prediction market data (free) | Prediction Markets |
| `chain_block_number` | Current block number (paid) | Chain |
| `chain_gas_price` | Current gas prices (paid) | Chain |
| `chain_balance` | Native token balance (paid) | Chain |
| `chain_token_balance` | ERC-20 token balance (paid) | Chain |
| `chain_tx` | Transaction details (paid) | Chain |
| `chain_wallet` | Wallet analysis (paid) | Chain |
| `chain_token_security` | Token security analysis (paid) | Chain |
| `chain_block_number_preview` | Current block number (free) | Chain |
| `chain_gas_price_preview` | Current gas prices (free) | Chain |
| `chain_token_security_preview` | Token security analysis (free) | Chain |

### Free vs Paid

- **Free (preview)** tools — 8 tools with `_preview` suffix. No wallet required. Rate-limited and return sample data.
- **Paid tools** — 14 tools. Requires `X402_WALLET_PRIVATE_KEY`. The x402 payment protocol auto-settles HTTP 402 responses using the provided wallet.

## Architecture

```
┌──────────────┐     stdio     ┌──────────────────────┐     HTTP POST     ┌───────────────────────┐
│  MCP Client  │◄───────────►│  x402-data-api-mcp   │────────────────►│  x402-data-api Worker │
│  (Claude,     │   JSON-RPC  │  (StdioServerTransport) │     /mcp         │  (Cloudflare Workers)  │
│   Cursor, ...)│             │                      │                  │                       │
└──────────────┘             └──────────────────────┘                  └───────────────────────┘
```

## Development

```bash
cd mcp-client
npm install
npx tsc                    # compile TS to dist/
node dist/server.js        # run (no wallet)
X402_WALLET_PRIVATE_KEY=0x... node dist/server.js  # with wallet
node test-mcp-client.mjs   # run tests against live production
npm pack --dry-run         # verify package
```

## License

Same as x402-data-api.
