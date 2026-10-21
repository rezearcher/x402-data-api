# Copy-paste examples

Base URL: `https://x402-data-api.sigrunner.workers.dev` — Base mainnet, USDC, no API key.
Free discovery: `/.well-known/x402`, `/openapi.json`, MCP at `/mcp`.

Your wallet needs a little USDC on Base. No gas ETH is required — the x402 scheme is
EIP-3009 gasless and the facilitator submits the transfer. Prices below are the live
402-challenge amounts (verified 2026-10-20); the authoritative price is always the
`maxAmountRequired` in the 402 response.

## Node — first paid call (x402-fetch + viem)
```js
// npm i x402-fetch viem
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";

const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY); // 0x-prefixed key, holds USDC on Base
const walletClient = createWalletClient({ account, chain: base, transport: http() });

// wrapFetchWithPayment(fetch, walletClient) — the 2nd arg is a viem WalletClient, not a bare account.
const f = wrapFetchWithPayment(fetch, walletClient);

const r = await f("https://x402-data-api.sigrunner.workers.dev/chain/token-report?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed");
console.log(await r.json()); // SAFE | CAUTION | AVOID — settles ~1s, costs $0.01 USDC
```

A full runnable version is in [`examples/buyer.mjs`](../examples/buyer.mjs):
`EVM_PRIVATE_KEY=0x... node examples/buyer.mjs`.

## Pre-trade gate pattern
Call `/gate/swap` ($0.008) before swapping into an unknown Base token — ONE decision
sized to your trade (honeypot/sellability + liquidity price impact):
```js
const r = await f("https://x402-data-api.sigrunner.workers.dev/gate/swap?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&side=buy&notional_usd=500");
const { decision } = await r.json(); // "GO" | "HOLD" | "BLOCK" — act only on "GO"
```
Deeper verdict: `/chain/token-report` ($0.01) returns SAFE|CAUTION|AVOID + risk_score 0-100 + reasons.
Both are also MCP tools (`gate_swap`, `chain_token_report`) at `/mcp`.

## Cross-venue funding-arb scanner
`/crypto/funding` ($0.001) ranks live perpetual funding spreads across Hyperliquid, OKX
and dYdX with the arb direction + annualized rates — a drop-in data feed for a funding
agent:
```js
const r = await f("https://x402-data-api.sigrunner.workers.dev/crypto/funding?limit=20");
const rows = await r.json(); // [{coin, funding_spread_bps, best_long_venue, best_short_venue, signal, ...}]
```
A full runnable scanner (free preview with no wallet, then the paid ranked scan) is in
[`examples/funding-arb-scanner.mjs`](../examples/funding-arb-scanner.mjs):
`node examples/funding-arb-scanner.mjs` (preview) · `EVM_PRIVATE_KEY=0x... node examples/funding-arb-scanner.mjs` (full scan).

## Audit an MCP server you run (free preview, works through auth)
If you operate MCP servers, screen the advertised tool metadata for tool-poisoning /
prompt-injection before trusting a tool. `/scan/mcp/preview` is static analysis of the
tool descriptions only — it never invokes a tool and nothing leaves your side except the
metadata your server already advertises. One tested one-liner pulls your server's
`tools/list` (through auth) and pipes it straight into the free preview:
```sh
BRIDGE=https://your-mcp-host/mcp TOKEN="Bearer eyJ..." ./examples/mcp-scan-preview.sh
```
Returns `tools_scanned`, severity breakdown, `risk_score` and a go/review verdict. The
paid itemized scan ($0.05 via `GET /scan/mcp`, or $0.005 as the `scan_mcp_server` MCP
tool) adds which tool, the evidence and remediation. Script:
[`examples/mcp-scan-preview.sh`](../examples/mcp-scan-preview.sh). Paste mode (no network
reachability needed): `POST {"tools":[...]}` to the same preview URL.

## Look before you pay (free, no wallet)
Every flagship route has a `/preview` with the same response shape — demo tokens are
unlimited, arbitrary real tokens get 3 free checks/IP/day, then a 429 with the paid URL:
```
curl -s "https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview?token=aero"
curl -s "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=degen&side=buy&notional_usd=100"
```

## Other priced routes (live amounts)
- `/crypto/prices?coins=bitcoin,ethereum` — $0.001 — spot prices + 24h change.
- `/crypto/funding?limit=20` — $0.004 — cross-venue perp funding + arb spread.
- `/defi/yields?limit=20` — $0.001 — top DeFi yields + IL/risk.
- `/pm/markets?query=&limit=20` — $0.005 — live Polymarket markets.
- `/scan/mcp?url=<mcp-server>` — $0.05 — MCP tool-poisoning / prompt-injection audit.
- `/chain/block-number`, `/chain/gas-price` — $0.01 each (free `/preview` = identical live data).

Measured uptime/latency (not an SLA): `GET /status` (machine-readable) or `docs/STATUS.md`.

Contact: contact@greyridgesignals.ai
