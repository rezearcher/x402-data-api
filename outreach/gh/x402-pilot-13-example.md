Thanks, here's a paste-ready example. It's one real, live x402 v2 seller on Base mainnet (USDC, exact scheme), usable as a decode_402 / inspect_payment_response / check_compliance target.

**1. Free preview (no wallet, same response shape as the paid route)**
```bash
B=https://x402-data-api.sigrunner.workers.dev
curl -s "$B/gate/swap/preview?token=weth"                    # go/hold/block verdict
curl -s "$B/chain/token-report/preview?token=usdc"           # full SAFE|CAUTION|AVOID report
```

**2. See the 402 challenge (what decode_402 would parse)**
```bash
curl -si "$B/gate/swap?token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&side=buy&notional_usd=100" | head -20
```
Returns `HTTP 402` with a base64 `payment-required` header: network `eip155:8453`, USDC, payTo `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`, amount `8000` ($0.008).

**3. Paid call (Node, `@x402/fetch` + `@x402/evm`)**
```ts
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.PK as `0x${string}`) });
const pay = wrapFetchWithPayment(fetch, client);

const r = await pay(
  "https://x402-data-api.sigrunner.workers.dev/gate/swap?token=0x4200000000000000000000000000000000000006&side=buy&notional_usd=250"
);
console.log(await r.json());  // { decision: "go"|"hold"|"block", verdict, risk_score, liquidity_usd, flags[] }
```
Use a throwaway wallet with well under $1 of USDC on Base; a call costs a cent or less.

Also listed in `/.well-known/x402` and `/openapi.json`. To check settlement against the on-chain balance change, the receiver is the payTo address above. Happy to reshape this to whatever format your `examples/` or eval tasks use, just tell me.
