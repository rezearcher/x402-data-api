# Your x402 fetch wrapper matched the amount. That is check #3 of 4 — now bind the nonce, locally

An x402-paying agent gets handed a `PAYMENT-RESPONSE` header the moment a seller settles. It carries `success: true` and a Base transaction hash. The overwhelming majority of agents read the boolean and move on. A smaller, more careful set now reads the transaction — they pull the receipt, decode the USDC `Transfer`, and confirm the right `payTo` received the right amount. That is real progress, and it is **check #3 of the market's four-part settlement standard**: the Transfer-amount reconcile.

It is also not enough on its own.

A matching `Transfer` to the correct `payTo` for the correct amount cannot distinguish a *fresh* settlement from a `PAYMENT-RESPONSE` that points at an **unrelated or replayed** USDC transfer which happens to hit the same recipient for the same value. Amount-match is necessary; it is not sufficient. The thing that makes a settlement unforgeable is the **EIP-3009 transfer authorization** behind it — and that has its own on-chain fingerprint you can check.

## What the 0.2.0 wrapper does

`@grey-ridge/x402-verified-fetch` is a drop-in `fetch` wrapper that **composes** the official Coinbase payer client — `@x402/fetch` / `wrapFetchWithPayment`, **671,132 downloads in the last 30 days** (npm registry, 2026-10-04 → 2026-11-02) — rather than replacing it. You keep your existing payment flow; you gain an independent, on-chain audit of what actually moved. As of **0.2.0** it runs **two** on-chain checks after every payment, not one:

- **Check #3 — Transfer reconcile.** Decode the receipt's USDC `Transfer` events from two independent public Base RPC endpoints and reconcile them against the `payTo` + amount the endpoint advertised in its own 402. Verdict: `SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED`.
- **Check #2 — EIP-3009 nonce consumed.** Decode the USDC `AuthorizationUsed(authorizer, nonce)` event from that same receipt, then cross-confirm — over the **same two independent RPCs** — that the live USDC contract's `authorizationState(authorizer, nonce)` reads **consumed**. That cryptographically binds the settlement to a spent transfer authorization, not just a Transfer that looks right.

If the amount matches but the authorization is **not** consumed on-chain — and both RPC providers agree on that — the verdict **fails closed to `UNVERIFIED`**. A strict agent is never told a replayed or re-pointed receipt `SETTLED`. A direct (non-EIP-3009) ERC-20 transfer **degrades open**: the Transfer reconcile still stands, and `authorization.status` reports `not-eip3009` rather than failing a legitimately-different settlement path. If the two RPCs disagree on the contract state, that is reported as `rpc-disagreement` and is **not** treated as proven. Every verdict carries an `authorization` field with its own cross-confirmed provenance.

## Where this sits versus the field

| Wrapper class | Pre-pay 402 checks | Reads the chain after paying | Binds the EIP-3009 nonce |
|---|---|---|---|
| `@x402/fetch` (official payer) | pays; no verification | no | no |
| Zero-RPC wrappers (budget cap / conformance / prompt-injection screen / header-hash linkage) | yes | no | no |
| Single-signer receipt verifiers | n/a | own receipts only | no |
| **`@grey-ridge/x402-verified-fetch` 0.2.0** | composes `@x402/fetch` | **yes, two independent RPCs** | **yes, dual-confirmed** |

The point of difference is narrow and real: this is the x402 fetch wrapper that reads the Base chain itself, and it now makes **two of the standard's four on-chain checks on arbitrary third-party settlements, keyless and cross-confirmed.** No viem/ethers requirement — it reads over plain JSON-RPC `fetch`, adding no runtime weight beyond `@x402/core`, which `@x402/fetch` already pulls in.

## Install (git channel; npm trusted-publishing pending)

```bash
npm install github:rezearcher/x402-verified-fetch
```

Resolves under the real package name `@grey-ridge/x402-verified-fetch` and builds on install via `prepare`.

```ts
import { wrapFetchWithVerifiedPayment } from "@grey-ridge/x402-verified-fetch";
import { x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";

const client = new x402Client().register("eip155:8453", new ExactEvmScheme(signer));

const fetchVerified = wrapFetchWithVerifiedPayment(fetch, client, {
  onMismatch: "throw",                        // abort if the settlement doesn't verify
  onSettlement: (s) => console.log(s.verdict, s.tx, s.authorization.status),
});

const res = await fetchVerified("https://seller.example/x402/data");
```

## Honesty (Claims Law)

This confirms the **on-chain settlement** went to the right address for the right amount and is bound to a consumed EIP-3009 authorization. It does **not** prove the off-chain resource was delivered, nor that its content is correct — later settlement failure or cache reuse is a separate failure mode, and a `SETTLED` verdict is a payment proof, not a delivery guarantee. Counterparty screening (OFAC / known-scam address) is the job of the hosted companion, not the local wrapper. Two of the four on-chain checks are shipped here; signature-recovery (#1) and the validity-window (#4) read the signed payload and are a future wrapper-only deepening.

If you would rather call a hosted endpoint than add a dependency, the same binding is available over HTTP at `/x402/receipt-verify`, and the pre-payment "will it settle / is it safe to pay" screen is at `/x402/preflight`.
