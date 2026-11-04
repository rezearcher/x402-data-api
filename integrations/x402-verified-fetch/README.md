# @grey-ridge/x402-verified-fetch

**A drop-in `fetch` wrapper for x402-paying agents that independently reads the Base chain and reconciles the settlement the endpoint claims — after you pay.**

Every other x402 fetch wrapper stops at the *pre-payment* 402: conformance checks, a budget cap, a response-prompt-injection screen, or a header/hash linkage. **None of them reads the chain.** This one does — it decodes the `PAYMENT-RESPONSE` the server returns after settlement, pulls that transaction's receipt from two independent public Base RPCs, decodes the USDC `Transfer` events, and reconciles them against the `payTo` + amount the endpoint advertised in its own 402.

The verdict is on-chain ground truth, not a claim the server made about itself:

```
SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED
```

### The full 4-check settlement standard — and the two checks only the payer can make

A matching `Transfer` to the right `payTo` for the right amount (**check #3**) is necessary but not sufficient. This wrapper runs all four checks of the x402 settlement-verification standard:

| # | check | what it proves | who can run it |
|---|-------|----------------|----------------|
| **3** | **Transfer reconcile** | a USDC transfer to the advertised `payTo` for ≥ the advertised amount exists in the tx | anyone reading the chain |
| **2** | **EIP-3009 nonce consumed** | the USDC `AuthorizationUsed(authorizer, nonce)` log cross-confirms against live `authorizationState() == consumed` — binds the settlement to a *spent* transfer authorization, catching a replayed/unrelated transfer to the same `payTo` | anyone reading the chain |
| **1** | **signed-payload bind** | the nonce consumed on-chain is **exactly the one THIS client signed** in its `X-PAYMENT` — the settlement is of *our* payment, not a coincidentally-matching one | **only the payer** |
| **4** | **validity window** | the settlement block's timestamp falls within the authorization's `[validAfter, validBefore]` — the authorization had not expired / was already valid when it settled | **only the payer** |

Checks #1 and #4 are the depth **no hosted verifier can offer**, including Grey Ridge's own `/x402/receipt-verify`: they require the signed EIP-3009 authorization, which only the paying client holds. This wrapper *is* the payer, so it captures the `X-PAYMENT` payload `@x402/fetch` sends and binds it to the on-chain settlement.

**Fail-closed signals** (verdict → `UNVERIFIED`, a strict agent is never told a bad settlement `SETTLED`):
- amount matches but the authorization is **not** consumed on-chain, dual-confirmed (check #2 forgery/replay);
- the consumed nonce is **not the one we signed** (check #1 — `payloadBind.status: "mismatch"`);
- the settlement mined **outside** the signed validity window, dual-confirmed block time (check #4 — `payloadBind.status: "window-violation"`).

A direct (non-EIP-3009) transfer degrades open and discloses it (`authorization.status: "not-eip3009"`, `payloadBind.status: "unbound"`). Every verdict carries `authorization` and `payloadBind` fields with their own cross-confirmed provenance. The nonce bind is the authoritative link; it is **not** a full secp256k1 signature recovery (that would need a crypto dependency this dep-free wrapper avoids), because a consumed EIP-3009 nonce is unforgeable and unique to the authorization that produced it.

### The 4th flaw class: cross-resource substitution (`resourceBinding`)

The four checks above all concern the **money** — who got paid, how much, that the authorization was genuinely spent, inside its window. They cannot answer a different question: **which resource did this payment actually buy?** x402's `exact` scheme signs `(from, to, value, validAfter, validBefore, nonce)` but **never the resource**, so one settlement to the right `payTo` for the right amount reconcile-validates as proof-of-payment for *any* x402 resource sharing that `(payTo, amount)`. That is the cross-resource substitution flaw ([arXiv:2605.30998](https://arxiv.org/abs/2605.30998)) — the 4th and last class in the x402 flaw taxonomy, and the one no money-side check sees.

Every verdict now carries a `resourceBinding` that ties the settlement to the resource **this client actually fetched**:

| `resourceBinding.verdict` | meaning |
|---|---|
| `DECLARED` | the live 402 the requested URL answered declares a `resource` matching that URL — the seller asserts the payment is for it (a declaration, **not** a cryptographic binding — `schemeBindsResource: false` always, disclosed) |
| `SUBSTITUTABLE` | the 402 declared **no** `resource` → nothing beyond `(payTo, amount)` ties the payment to a resource; the same settlement is transplantable to any sibling endpoint |
| `RESOURCE_MISMATCH` | the 402 declared a **different** resource than the URL you fetched — do not treat the settlement as proof of payment for your URL |
| `UNVERIFIED` | no live 402 was read (you passed `expected`, `resolveAdvertised: "off"`, or a POST) |

**Only the payer can bind this honestly.** A hosted verifier (including Grey Ridge's own `/x402/receipt-verify`) only ever gets a `url` the caller *claims* they paid — it cannot know which resource the client truly requested. This wrapper **is** the client: it holds the exact URL the agent fetched and reads the live 402 that URL answers with, so the comparison is against ground truth the client observed first-hand. That makes this **the only x402 fetch wrapper that covers all four flaw classes** (payTo, amount, replay/authorization, and resource) — the six other `@x402/fetch` wrappers read no chain at all, and no hosted verifier can run checks #1, #4, or an authoritative resource bind.

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
import {
  readSettlementReceipt, reconcileSettlement, decodeUsdcTransfers,
  readBlockTimestamp, decodeSignedAuthorization, computePayloadBind,
} from "@grey-ridge/x402-verified-fetch";

const read = await readSettlementReceipt(txHash);                 // dual-RPC, cross-confirmed
const verdict = reconcileSettlement(read.status, read.transfers,  // pure (check #3)
  advertisedPayTo, advertisedAmountAtomic);

// payer-only checks (#1 + #4): bind the X-PAYMENT you signed to the settlement
const signed = decodeSignedAuthorization(xPaymentHeader);         // pure
const { timestamp } = await readBlockTimestamp(read.block);       // dual-RPC, cross-confirmed
const bind = computePayloadBind(signed, matchedTo, matchedAtomic, // pure
  consumedNonce, timestamp, "dual-confirmed");
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
