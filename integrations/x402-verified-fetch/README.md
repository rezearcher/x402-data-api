# @grey-ridge/x402-verified-fetch

**A drop-in `fetch` wrapper for x402-paying agents that independently reads the Base chain and reconciles the settlement the endpoint claims — after you pay.**

Every other x402 fetch wrapper stops at the *pre-payment* 402: conformance checks, a budget cap, a response-prompt-injection screen, or a header/hash linkage. **None of them reads the chain.** This one does — it decodes the `PAYMENT-RESPONSE` the server returns after settlement, pulls that transaction's receipt from two independent public Base RPCs, decodes the USDC `Transfer` events, and reconciles them against the `payTo` + amount the endpoint advertised in its own 402.

The verdict is on-chain ground truth, not a claim the server made about itself:

```
SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED
```

### Two on-chain checks, not one (the EIP-3009 depth)

A matching `Transfer` to the right `payTo` for the right amount (**check #3** of the market's 4-check settlement standard) is necessary but not sufficient: it cannot catch a `PAYMENT-RESPONSE` that points at an **unrelated or replayed** USDC transfer which happens to hit the same `payTo` for the same amount. So this wrapper also runs **check #2 — the EIP-3009 authorization nonce**: it decodes the USDC `AuthorizationUsed(authorizer, nonce)` event from the receipt and cross-confirms, over the same two independent RPCs, that the live USDC contract's `authorizationState(authorizer, nonce)` reads **consumed**. That cryptographically binds the settlement to a spent transfer authorization.

If the amount matches but the authorization is **not** consumed on-chain (dual-confirmed), that is a forgery/replay signal and the verdict **fails closed to `UNVERIFIED`** — a strict agent is never told a replayed receipt `SETTLED`. A direct (non-EIP-3009) transfer degrades open: the `Transfer` reconcile still stands and `authorization.status` reports `not-eip3009`. Every verdict carries an `authorization` field with its own cross-confirmed provenance. No other x402 fetch wrapper does this; the hosted Grey Ridge endpoint makes the same binding.

It **composes** the official Coinbase payer client (`@x402/fetch` → `wrapFetchWithPayment`, 670k+ downloads/mo) rather than replacing it. You keep your existing payment flow; you gain an independent audit of what actually moved.

> **Honesty (Claims Law):** this confirms the on-chain settlement went to the right address for the right amount. It does **not** prove the off-chain resource was delivered or that its content is correct — later settlement failure or cache reuse is a separate failure mode. A `SETTLED` verdict is a payment proof, not a delivery guarantee.

## Why this exists

The x402 spec hands the client a `PAYMENT-RESPONSE` header containing the on-chain tx hash once the server settles. Trusting the server's `success: true` without reading that tx is exactly the gap the research flags: *"after the server releases the resource, later settlement failure cannot be naturally rolled back."* A paying agent that never checks the chain can be told it paid an endpoint when the USDC actually went somewhere else, went short, or never moved. This wrapper closes that loop locally, for free, with no account.

## Install

npm trusted-publishing for the `@grey-ridge` scope is still being set up, so install straight from git (resolves under the real package name `@grey-ridge/x402-verified-fetch`, builds on install via `prepare`):

```bash
npm install github:rezearcher/x402-verified-fetch
```

Peer: you already have `@x402/fetch` + `@x402/evm` in an x402-paying agent; this adds no new runtime weight beyond `@x402/core` (which `@x402/fetch` already pulls in). **Zero RPC SDK** — it reads the chain over plain JSON-RPC `fetch`, so there is no `viem`/`ethers` requirement.

## Use

```ts
import { wrapFetchWithVerifiedPayment } from "@grey-ridge/x402-verified-fetch";
import { x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";

const client = new x402Client().register("eip155:8453", new ExactEvmScheme(signer));

const fetchVerified = wrapFetchWithVerifiedPayment(fetch, client, {
  onMismatch: "throw",                       // abort if the settlement doesn't verify
  onSettlement: (s) => console.log(s.verdict, s.tx, s.block),
});

const res = await fetchVerified("https://seller.example/x402/data");
// res.headers.get("x-grs-settlement") -> full verdict JSON
```

Read the verdict off the response header, via the `onSettlement` callback, or let a failed settlement throw:

```ts
import { SETTLEMENT_HEADER } from "@grey-ridge/x402-verified-fetch";
const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
// { verdict: "SETTLED", settled: true, tx, network, payer, block,
//   confirmation: "dual-confirmed", rpcSources: [...], advertised: {...}, matched: {...},
//   authorization: { status: "consumed", authorizer, nonce, confirmation: "dual-confirmed", ... } }
```

### Options

| option | default | meaning |
|---|---|---|
| `reconcile` | `"local"` | `"local"` reads the chain itself; `"off"` is a pass-through payer. |
| `onMismatch` | `"annotate"` | `"annotate"` attaches the verdict and lets the response through (degrade-open — never silently breaks a paying agent); `"throw"` raises `X402SettlementError` on a failed settlement. |
| `resolveAdvertised` | `"probe"` | `"probe"` sends one unpaid `GET` to capture the endpoint's live 402 payTo+amount; set `expected` to skip it (**required for POST** — the probe never re-sends a side-effecting request). |
| `expected` | — | `{ payTo, amountUsdc, amountIsCap }` to bind the reconcile directly. |
| `rpcUrls` | public Base RPCs | up to 2 providers, cross-confirmed. |
| `onSettlement` | — | callback with the verdict after every settled request. |

## Independent primitives

Everything is exported pure and I/O-free so you can reconcile a receipt you already have:

```ts
import { readSettlementReceipt, reconcileSettlement, decodeUsdcTransfers } from "@grey-ridge/x402-verified-fetch";

const read = await readSettlementReceipt(txHash);                 // dual-RPC, cross-confirmed
const verdict = reconcileSettlement(read.status, read.transfers,  // pure
  advertisedPayTo, advertisedAmountAtomic);
```

## Cross-confirmation (fail closed)

`readSettlementReceipt` queries two independent Base RPCs and fingerprints each receipt's `(status + USDC transfers + authorization nonces)`:

- both reachable **and agree** → `dual-confirmed`
- both reachable **and differ** → `rpc-disagreement` → verdict `UNVERIFIED` (we refuse to trust a single source)
- only one reachable → `single-source` (degrade-open, disclosed in `confirmation`)

A single RPC returning a stale or forged receipt cannot move the verdict on its own.

## Hosted companion

For a managed verdict (OFAC/scam screening of the counterparty, richer provenance, a persistent audit trail) the same logic runs behind Grey Ridge's hosted x402 API — see the live, free example at
<https://api.greyridgesignals.ai/x402/receipt-verify/preview>. This package is the local, dependency-light form of the post-payment half; `/x402/preflight` is the pre-payment half.

## License

MIT · Grey Ridge Signals Group
