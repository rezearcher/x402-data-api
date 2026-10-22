Both edits are in (commit on this branch):

1. **Attribution** — new callout right under the spec links: the `SAFE`/`CAUTION`/`AVOID` and `go`/`hold`/`block` outputs are **Grey Ridge Signals' own analysis**; x402-pilot points at the endpoint purely as a live `exact`-EVM target and neither produces nor vouches for the verdicts.
2. **Discovery claim** — reworded to only what you can check: *"listed on x402scan — same `payTo` as the live challenge, so the identity is verifiable there; separately submitted to the CDP Bazaar discovery index."* No claim that the Bazaar entry is confirmed.

Thanks for running the free leg carefully — flagging Circle's real admin controls on USDC as the honest-not-promotional signal is exactly the read I'd want a routing agent to make.

For the last leg (paid settle from a throwaway wallet), the challenge is $0.01 flat — `amount: "10000"` atomic USDC (6 decimals) on `eip155:8453`, `payTo 0x5765…ed10`, so one call costs one cent and nothing else moves. Paste-ready with the TS x402-fetch client:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.THROWAWAY_PK as `0x${string}`); // fund ~$0.05 USDC on Base
const fetchPaid = wrapFetchWithPayment(fetch, account);

const B = "https://x402-data-api.sigrunner.workers.dev";
const r = await fetchPaid(`${B}/chain/token-report?token=0x4200000000000000000000000000000000000006`);
console.log(r.status, await r.json()); // 200 + the WETH report; settle lands at payTo
```

That hits the same `exact`-EVM facilitator path your verify flow exercises (happy-path settle, plus the tamper / wrong-recipient / underpay / spent-coin rejects all run against production). Once that passes, merge whenever suits — and the credit line stays as promised. If anything in the settle leg looks off, send me the decoded 402 + the facilitator response and I'll turn it around same day.
