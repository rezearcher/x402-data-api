---
name: x402-verify-before-and-after-you-pay
description: Protect an agent that pays x402 (HTTP 402) endpoints. Before paying, screen the endpoint — will it settle, is the recipient sanctioned or a known scam wallet, is the price what it claims, is the resource laced with prompt injection — and get a PAY / CAUTION / AVOID verdict. After paying, reconcile the real on-chain USDC settlement against the recipient and amount the endpoint advertised, so you know the payment actually landed where it was supposed to. Use when an agent is about to pay, or has just paid, an x402 service.
license: MIT
---

# Verify before and after you pay an x402 endpoint

An agent with a wallet can now pay any `HTTP 402` endpoint on its own. Nothing in
the x402 handshake tells it whether the endpoint is honest, whether the recipient
is a sanctioned or drainer address, whether the advertised price is the price it
will actually be charged, or — once it has paid — whether the money landed where
it was promised. This skill closes both halves of that gap.

Two moments matter, and they are separate on-chain events with no shared state:

- **Before you pay** — screen the endpoint and decide.
- **After you pay** — prove the settlement matched what was advertised.

Pre-payment screeners cannot see the second half; a settlement can still go to the
wrong recipient, be underpaid, or revert after a clean pre-pay screen. Do both.

---

## 1. Before you pay — screen the endpoint

Call the pre-flight check with the URL you are about to pay. One read-only request;
it never spends. You get a single verdict plus the reasons behind it.

```
GET https://api.greyridgesignals.ai/x402/preflight?url=<endpoint-you-want-to-pay>
```

What it checks and returns (`verdict`: `PAY` | `CAUTION` | `AVOID`):

- **will it settle** — validates the 402 challenge and `accepts[]`; labels liveness
  `LIVE | ZOMBIE | DEAD`.
- **safe to pay** — screens `payTo` against the OFAC SDN list and a community
  scam/drainer set; scans the resource and any advertised MCP tools for LLM01 /
  LLM08 prompt-injection; flags an absolute price-trap (>= $1000 => `AVOID`).
- **price accuracy** — live `accepts[].amount` vs the price the endpoint advertises:
  `MATCH | OVERCHARGE | UNDERCHARGE`.
- **delivery readiness** — whether the paid resource is actually declared/served.

Decision rule for the agent:

- `PAY` — proceed.
- `CAUTION` — proceed only if the specific flagged reason is acceptable for this call.
- `AVOID` — do not pay; pick another provider.

Try it free, no wallet, deterministic example:

```
GET https://api.greyridgesignals.ai/x402/preflight/preview
```

The live verdict call is x402 pay-per-call (USDC on Base, sub-cent, no API key) — your
wallet settles the 402 automatically.

---

## 2. After you pay — prove the settlement

A clean pre-pay screen does not prove the money arrived correctly. After the payment
settles, reconcile the real receipt against what the endpoint advertised:

```
GET https://api.greyridgesignals.ai/x402/receipt-verify?tx=<base-settlement-tx>&url=<endpoint-you-paid>
```

It reads the transaction receipt from Base mainnet over two independent RPCs, decodes
the USDC `Transfer` events, cross-confirms the EIP-3009 authorization nonce against
the token's live `authorizationState`, and reconciles the result against the
endpoint's advertised `payTo` + amount:

```
SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED
```

Only `SETTLED` means the payment landed, at the advertised recipient, for the
advertised amount, with a consumed (non-replayable) authorization. Anything else is a
problem to surface to the caller before trusting the response you paid for.

Free deterministic example:

```
GET https://api.greyridgesignals.ai/x402/receipt-verify/preview
```

---

## 3. Make it automatic in code (optional)

If your agent pays x402 endpoints through `@x402/fetch`, drop in the verifying
wrapper — it keeps the exact same call signature and adds the post-pay on-chain
reconcile (both checks above, client-side, over two Base RPCs):

```bash
npm i github:rezearcher/x402-verified-fetch
```

```ts
import { wrapFetchWithVerifiedPayment } from "@grey-ridge/x402-verified-fetch";
import { wrapFetchWithPayment } from "@x402/fetch";

const fetchWithVerify = wrapFetchWithVerifiedPayment(fetch, walletClient);
const res = await fetchWithVerify("https://some-x402-api.example/paid");
// The verdict rides on a response header as JSON:
const s = JSON.parse(res.headers.get("x-grs-settlement") ?? "{}");
// s.verdict -> SETTLED | UNDERPAID | WRONG_RECIPIENT | ... (independently verified on-chain)
// s.rail    -> "evm" (Base) | "svm" (Solana) — both rails reconciled client-side
```

Unlike hosted verifiers, the wrapper also binds the *signed* payment payload to the
nonce consumed on-chain and checks the settlement block against the authorization's
validity window — two checks only the payer can make (a server-side verifier such as
anchor-x402 or x402-trust-layer sees only the claimed parameters, never the signed
payload or the exact resource fetched).

---

## Use this skill when

- An agent is about to pay an x402 / HTTP 402 endpoint and should decide first.
- An agent has just paid one and needs to confirm the settlement was correct.
- You are choosing between x402 providers and want a safety read on each `payTo`.

## Notes

- "Clear" is not a guarantee of safety — screening narrows risk, it does not remove it.
- Verdicts are point-in-time reads of on-chain and endpoint state at call time.
- Operated by Grey Ridge Signals. Endpoints: https://api.greyridgesignals.ai
