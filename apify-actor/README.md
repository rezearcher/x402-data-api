# Grey Ridge — Base On-Chain Data Proxy

[![Apify Actor](https://img.shields.io/badge/Apify-Actor-blue)](https://console.apify.com/actors)
[![x402](https://img.shields.io/badge/powered%20by-x402-6b9fff)](https://x402.org)

**Query Base mainnet on-chain data from any Apify workflow. No API key, no sign-up — the Actor is $0.001/run via Apify's x402 integration.**

---

## What it does

This Actor wraps the [Grey Ridge Signals x402 Data API](https://x402-data-api.sigrunner.workers.dev) — a pay-per-call on-chain data service on Base — into an Apify Actor. It handles four common on-chain lookups:

| Query | Source | Cost in run |
|---|---|---|
| **Gas price** (`gas_price_wei`, `gas_price_gwei`, EIP-1559 breakdown, USD) | x402 free preview | $0 (included) |
| **Block number** | x402 free preview | $0 (included) |
| **Wallet ETH balance** (`balance_eth`, `balance_usd`) | Direct Base RPC | $0 (included) |
| **ERC-20 token balance(s)** (`symbol`, `decimals`, `balance_formatted`) | Direct Base RPC | $0 (included) |

**One run = $0.001.** You can query as many wallets and tokens as you want in a single run — all balance queries use free public RPC, so there's no per-call markup.

---

## Input schema

| Field | Type | Default | Description |
|---|---|---|---|
| `wallets` | `string[]` | `[]` | Base wallet addresses to query |
| `tokens` | `string[]` | `[]` | ERC-20 token contract addresses |
| `includeGasPrice` | `boolean` | `true` | Fetch current Base gas price |
| `includeBlockNumber` | `boolean` | `true` | Fetch latest Base block number |
| `performTokenSecurityCheck` | `boolean` | `false` | Run honeypot scan ($0.02/token extra — see below) |

### Example input

```json
{
  "wallets": [
    "0x4200000000000000000000000000000000000006",
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  ],
  "tokens": [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  ],
  "includeGasPrice": true,
  "includeBlockNumber": true
}
```

### Standard Base tokens

| Token | Address |
|---|---|
| **USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| **WETH** | `0x4200000000000000000000000000000000000006` |
| **cbBTC** | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` |
| **AERO** | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` |
| **VIRTUAL** | `0x0b3e328455c4059eEb9e3f84b5543F74E24e7E1b` |

---

## Output

Results are pushed to the Apify dataset and the key-value store (`OUTPUT`).

### Dataset structure

Three record types:

```jsonc
// ETH balance
{
  "type": "eth_balance",
  "results": [
    {
      "address": "0x4200000000000000000000000000000000000006",
      "balance_eth": 12.345,
      "balance_wei": "12345000000000000000",
      "balance_usd": 34566.80,
      "chain": "base"
    }
  ],
  "meta": { "block_number": 27738421, "run_timestamp": "2026-07-17T12:00:00Z" }
}

// Token balance
{
  "type": "token_balance",
  "results": [
    {
      "address": "0x4200000000000000000000000000000000000006",
      "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "symbol": "USDC",
      "decimals": 6,
      "balance_raw": "1050000",
      "balance_formatted": 1.05,
      "chain": "base"
    }
  ],
  "meta": { "block_number": 27738421, "run_timestamp": "2026-07-17T12:00:00Z" }
}

// Metadata (gas price, block number)
{
  "type": "metadata",
  "run_timestamp": "2026-07-17T12:00:00Z",
  "chain": "base",
  "network_id": "eip155:8453",
  "gas_price": {
    "gas_price_wei": 123456789,
    "gas_price_gwei": 0.123,
    "base_fee_gwei": 0.1,
    "priority_fee_gwei": 0.023,
    "chain": "base",
    "source": "x402-api-preview"
  },
  "block_number": {
    "block_number": 27738421,
    "chain": "base",
    "source": "x402-api-preview"
  }
}
```

### Key-value store OUTPUT

```json
{
  "status": "completed",
  "wallets_queried": 2,
  "tokens_queried": 1,
  "balances_found": 2,
  "token_balances_found": 2,
  "errors": 0,
  "meta": { ... }
}
```

---

## Pricing

| Plan | Per-run | Balance lookups | Notes |
|---|---|---|---|
| **Gas + Block** | $0.001 | — | Any number of wallet/token lookups included |
| **With wallet queries** | $0.001 | Unlimited | Direct RPC — no per-address cost |
| **+Token security** | $0.02/token | Unlimited | Optional honeypot scan via /chain/token-security |

Each run costs exactly $0.001 USDC, paid via Apify's x402 integration. There are no volume discounts because there's no per-call billing inside the run.

---

## Use cases

### Portfolio tracker (via Apify scheduler)

Schedule this Actor to run daily and push results into a Google Sheet via Apify's [integrations](https://docs.apify.com/integrations).

```bash
apify run -p -i '{
  "wallets": ["0xYourWallet"],
  "tokens": ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  "includeGasPrice": true,
  "includeBlockNumber": true
}'
```

### Webhook-powered alerts

Combine with Apify webhooks: trigger an alert when `gas_price_gwei > 1.0` or a wallet drops below a threshold.

### AI agent data feed

Use this Actor inside a multi-agent pipeline: one agent queries wallet balances, another agent reasons about them. The clean JSON output feeds directly into an LLM context window.

---

## Architecture

```
┌──────────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  Apify Runner    │ ──> │  Grey Ridge Actor     │ ──> │ Base RPC    │
│  ($0.001/run)    │     │  (this repo)          │     │ (public)    │
└──────────────────┘     │                       │     └─────────────┘
                         │  • /chain/gas-price   │     ┌─────────────┐
                         │    /preview (FREE)     │ ──> │ x402 API    │
                         │  • /chain/block-number │     │ (free       │
                         │    /preview (FREE)     │     │  previews)  │
                         │  • balanceOf (RPC)     │     └─────────────┘
                         │  • token balance (RPC) │
                         └──────────────────────┘
```

The Actor uses **free preview endpoints** from the x402-api for gas and block data, and **direct public JSON-RPC** for balance lookups — no x402 payment key needed inside the Actor. For full x402-paid access (including tx details, receipts, contract code, and the wallet bundle), use the API directly from your own agent.

---

## Direct API access (x402 paid)

For agents that prefer raw HTTP or MCP access (no Apify), the full Grey Ridge API is available:

- **Base URL:** `https://x402-data-api.sigrunner.workers.dev`
- **MCP endpoint:** `https://x402-data-api.sigrunner.workers.dev/mcp`
- **Docs:** [`/.well-known/x402`](https://x402-data-api.sigrunner.workers.dev/.well-known/x402) · [`/openapi.json`](https://x402-data-api.sigrunner.workers.dev/openapi.json) · [`/llms.txt`](https://x402-data-api.sigrunner.workers.dev/llms.txt)

Paid endpoints cost $0.001–$0.02 and require an x402-compatible wallet. The Actor is the **Apify-native wrapper** — no wallet needed on your end.

---

## Development

```bash
# Install deps
pip install -r requirements.txt

# Run locally
apify run

# Build and push
apify push
```

### Project structure

```
apify-actor/
├── .actor/
│   ├── actor.json           # Actor definition
│   ├── Dockerfile           # Container build
│   └── input_schema.json    # Input UI schema
├── src/
│   └── main.py              # Actor logic
├── requirements.txt         # Python deps
└── README.md                # This file
```

---

## License

MIT — see the [x402-data-api LICENSE](../../LICENSE).
