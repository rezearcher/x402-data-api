# Copy-paste examples

Base URL: https://api.greyridgesignals.ai — Base mainnet, USDC, no API key.
Free discovery: `/.well-known/x402`, `/openapi.json`, MCP at `/mcp`.

## Node (x402-fetch)
```js
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
const f = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PK));
const r = await f("https://api.greyridgesignals.ai/chain/token-report?token=0x4200000000000000000000000000000000000006");
console.log(await r.json());
```

## Pre-trade gate pattern
Call `/chain/token-report` ($0.05) before swapping into an unknown Base token; refuse on `AVOID`.

Cheaper single-call version — `/gate/swap` ($0.01) returns go / hold / block for a specific trade size:
```js
const r = await f("https://api.greyridgesignals.ai/gate/swap?token=0x4200000000000000000000000000000000000006&side=buy&notional_usd=500");
const { decision } = await r.json(); // "go" | "hold" | "block" — act only on "go"
```
Also available as the `gate_swap` MCP tool at `/mcp`.

## Cheap reads ($0.001)
`/chain/balance`, `/chain/token-balance`, `/chain/gas-price`, `/chain/tx`, `/crypto/funding`.

Contact: contact@greyridgesignals.ai
