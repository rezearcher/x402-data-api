# Apify Actor Launch Guide

## Overview

The Grey Ridge Base On-Chain Data Proxy is an [Apify Actor](https://console.apify.com/actors) that wraps the x402-data-api into a serverless data pipeline. This doc covers deploying, testing, scheduling, and integrating the Actor.

## Prerequisites

- [Apify account](https://console.apify.com) (free tier works for dev)
- [Apify CLI](https://docs.apify.com/cli) installed: `npm -g install apify-cli`
- Python 3.11+ (for local dev/testing)
- Docker (optional — `apify push` builds in the cloud)

## Deploy

```bash
cd apify-actor

# Login (one-time)
apify login

# Push the Actor to Apify Console
apify push
```

This builds the Docker image and pushes it to Apify's registry. Your Actor appears at `https://console.apify.com/actors/<username>/grey-ridge-base-onchain`.

## Input schema

The Actor's web UI (in Console) renders the fields from `.actor/input_schema.json`. The JSON editor array fields accept `0x` addresses:

### Quick test input

```json
{
  "wallets": ["0x4200000000000000000000000000000000000006"],
  "tokens": ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  "includeGasPrice": true,
  "includeBlockNumber": true
}
```

### Expected dataset output after run

Three records:

1. `type: "eth_balance"` — WETH address ETH balance
2. `type: "token_balance"` — USDC balance at that address
3. `type: "metadata"` — gas price + block number (if enabled)

## Pricing & billing

| Item | Cost | Charge |
|---|---|---|
| Actor run (base) | $0.001 USDC | 1x per run, via Apify x402 integration |
| Gas price query | $0 | Free x402 preview |
| Block number query | $0 | Free x402 preview |
| ETH balance (per wallet) | $0 | Direct RPC |
| Token balance (per wallet-token pair) | $0 | Direct RPC |
| Token security check (per token) | $0.02 | Only if enabled — paid /chain/token-security |

**One wallet + one token = $0.001 total.** Ten wallets + ten tokens = still $0.001 total. Only the token security check adds cost.

## Scheduled runs

In Apify Console, navigate to your Actor → **Schedules** → **Add schedule**.

| Use case | Schedule | Input |
|---|---|---|
| Daily portfolio snapshot | `0 8 * * *` (daily 8am UTC) | Your wallet list + token list |
| Hourly gas price monitor | `0 * * * *` (hourly) | Just `includeGasPrice: true`, no wallets |
| Weekly deep scan | `0 0 * * 1` (weekly Monday) | Full wallet list + token security check |

## Webhooks

Apify webhooks let you react to run completions automatically.

### Example: Wallet balance alert

1. Go to Actor → **Webhooks** → **Add webhook**
2. Event: `RUN.SUCCEEDED`
3. Request URL: `https://your-alert-endpoint.com/apify-callback`
4. Request template:
```json
{
  "event": "{{event}}",
  "run_id": "{{resource.id}}",
  "output": "{{resource.defaultKeyValueStoreUrl}}",
  "dataset": "{{resource.defaultDatasetUrl}}"
}
```

Then in your callback handler:
```python
# Pseudocode — implement in your own endpoint
dataset = requests.get(payload["dataset"] + "/items").json()
for record in dataset:
    if record["type"] == "eth_balance":
        for bal in record["results"]:
            if bal["balance_eth"] < 0.1:
                send_alert(f"Wallet {bal['address']} low: {bal['balance_eth']} ETH")
```

### Built-in integrations

Apify offers native integrations to:
- **Google Sheets** — push results straight to a spreadsheet
- **Slack** — post results to a channel
- **Webhook** — any HTTP endpoint
- **S3 / GCS / Azure** — push to cloud storage

Set these up at Actor → **Integrations** in the Console.

## Multi-agent pipeline

This Actor is designed to feed AI agent workflows:

```
step 1: grey-ridge-base-onchain (query wallets)
             │
             ▼
step 2: your-llm-agent (reason about balances → decide to trade)
             │
             ▼
step 3: your-execution-actor (send tx on Base)
```

Apify's **Actor-to-Actor calls** via `apify call <actor-id>` let you build this pipeline:

```bash
# First: get balances
apify call grey-ridge-base-onchain --input '{
  "wallets": ["0xMyWallet"],
  "tokens": ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]
}' --token $APIFY_TOKEN

# Then: pass output to next actor
apify call your-llm-actor --input '{"balance": <dataset-output>}'
```

## Local testing (without Docker)

```bash
# Install deps (not needed in Docker — built by apify push)
pip install -r requirements.txt

# Test the core logic directly
python -c "
from src.main import fetch_gas_price, _rpc_call
import httpx
cli = httpx.Client()
gp = fetch_gas_price(cli)
print(gp)
"
```

## Architecture decisions

1. **Free previews for gas + block** — these are live, identical to paid but no x402 challenge. Saves $0.002/run.
2. **Direct RPC for balances** — avoids a paid x402 call for each wallet/token pair. Uses the same public RPC endpoints as the x402 backend.
3. **Multi-provider failover** — if `mainnet.base.org` flakes, falls through to `base.llamarpc.com`, `base-rpc.publicnode.com`, and `base.drpc.org`.
4. **No secrets/API keys** — the Actor requires zero configuration beyond wallet addresses. Every data source is public.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `desc = "request failed"` | RPC endpoint down (rate-limit or outage) | Wait and retry — failover should handle transient blips |
| `eth_call returned None` | Token address invalid or not ERC-20 | Double-check token address on BaseScan |
| `gas_price_gwei = 0` | x402 preview endpoint returned empty | Retry — preview endpoint may have upstream latency |
| Actor times out (>30s) | Too many wallet/token pairs (50+) | Add [`actor.max_run_time_secs`](https://docs.apify.com/platform/actors/development/actor-definition#actorjson) to actor.json |

## Release checklist

- [x] `actor.json` with correct name/title/description
- [x] `input_schema.json` with all input fields
- [x] `Dockerfile` using `apify/actor-python`
- [x] `requirements.txt` with `apify` + `httpx`
- [x] `src/main.py` — full actor logic with RPC failover
- [x] `README.md` — comprehensive with examples
- [x] Price at $0.001/run in metadata
- [ ] `apify login` — one-time CLI auth
- [ ] `apify push` — builds and deploys to Apify Console
- [ ] Test via Console with real wallet addresses
- [ ] Set up daily schedule
- [ ] Wire webhook to Google Sheets or Slack
