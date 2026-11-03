# safe_fetch: a drop-in wrapper that checks an x402 endpoint before paying and proves settlement after

Most x402 client code does one thing: hit a URL, get a 402, sign, pay. Nothing in that loop asks whether the endpoint will actually settle, whether the price matches what it advertised, or whether the money landed where it said it would. `safe_fetch` (Python) and `safeFetch` (Node) wrap your existing payment fetch with both checks. They add no new key handling: you bring your own wallet.

## The flow

1. **Free preflight.** Before any money moves, it calls the hosted preview of `/x402/preflight`: reachability, a valid 402 challenge, `accepts[]`, delivery readiness, liveness, and a payee screen against the OFAC list and community scam lists. Verdict: PAY, CAUTION or AVOID.
2. **Refuse on AVOID.** It raises `PreflightBlocked` (set `blockOnCaution` to refuse CAUTION too). Your key is never used.
3. **Pay with your own key.** Your `wrapFetchWithPayment` (Node) or `private_key` (Python) does the payment as before.
4. **Prove after.** If the server returns a settlement tx header, it checks that tx on Base against the endpoint's advertised recipient and amount, reading the receipt from two RPC providers. Verdicts: SETTLED, UNDERPAID, WRONG_RECIPIENT, and others. Without a tx header the receipt step is skipped and noted in `notes`.

## Python

```python
from greyridge_x402.safe_fetch import safe_fetch, PreflightBlocked

try:
    res = safe_fetch("https://api.example.com/paid", private_key="0x...")
except PreflightBlocked as e:
    print("not paying:", e.preflight["verdict"])
else:
    print(res.response.json(), res.preflight["verdict"], res.receipt["verdict"])
```

Install: `pip install "greyridge-x402-tools[pay]"`.

## Node / TypeScript

```js
import { safeFetch, PreflightBlocked } from "greyridge-x402-tools";
import { wrapFetchWithPayment } from "x402-fetch";

const payFetch = wrapFetchWithPayment(fetch, account);
try {
  const r = await safeFetch("https://api.example.com/paid", { payFetch, blockOnCaution: true });
  console.log(r.preflight.verdict, r.receipt?.verdict, r.settled);
} catch (e) {
  if (e instanceof PreflightBlocked) console.log("refused:", e.preflight.verdict);
}
```

Install: `npm install github:rezearcher/greyridge-x402-tools` (ESM only, dependency-free).

## What a refusal looks like

When we ran the free preflight preview against `https://api-xpay.com/x402/time` for this post, it returned **AVOID** with `will_settle: false`: the host answered HTTP 530 instead of a 402 challenge, there was no `accepts[]`, and the liveness check labeled it ZOMBIE (reachable but not presenting a payable challenge). With `safe_fetch`, that call raises `PreflightBlocked` before your wallet signs anything. That is a point-in-time reading; endpoints come and go, so check the live result yourself.

## Limits, stated plainly

- Preflight is a pre-payment readiness check, not a guarantee the endpoint will deliver a useful response.
- The hosted preview allows 3 real checks per IP per day. Unmetered paid versions are $0.001 (preflight) and $0.004 (receipt verify) per call.
- Receipt proof needs the server to return a settlement tx header. It proves the USDC transfer landed at the advertised recipient, not that the data you got back was correct.
- "Clear" on the payee screen means not on the lists we check. It does not mean safe.

Related: [check an x402 endpoint before paying](https://api.greyridgesignals.ai/research/check-x402-endpoint-before-paying-settle-and-safe) · [verify a payment settled on-chain](https://api.greyridgesignals.ai/research/verify-x402-payment-settled-onchain-receipt-proof) · [one-line uvx verify server](https://api.greyridgesignals.ai/research/uvx-one-line-x402-verify-mcp-server-python-agents)
