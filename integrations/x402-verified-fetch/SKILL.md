---
name: x402-verified-payment-fetch
description: Make an agent that pays x402 (HTTP 402) endpoints verify every settlement on-chain, client-side, before it trusts the response it paid for. Drop-in wrapper around @x402/fetch that keeps the same call signature and adds a post-payment reconcile over two independent public RPCs on BOTH rails — Base (EVM USDC) and Solana (SVM SPL-USDC) — returning SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | UNVERIFIED. Use when an agent with a wallet auto-pays x402 services and must not act on an unpaid, underpaid, mis-settled, or wrong-recipient response.
license: MIT
---

# Verify every x402 payment on-chain, from the client

An agent with a wallet can auto-settle any `HTTP 402` challenge. The x402
handshake tells it nothing about whether the money actually landed — at the
recipient the endpoint advertised, for the amount it advertised, with a
non-replayable authorization, for the resource it actually fetched. A facilitator
that returns `"settled": true` is a *claim*, not a receipt. This skill makes the
agent read the chain itself and decide.

## Install

```bash
npm i github:rezearcher/x402-verified-fetch
```

(ESM, dependency-free beyond `@x402/fetch` + a wallet client; keyless public RPC, $0 COGS.)

## Use

Same signature as `@x402/fetch`'s `wrapFetchWithPayment` — it drops into an existing x402-paying agent with one line changed:

```ts
import { wrapFetchWithVerifiedPayment } from "@grey-ridge/x402-verified-fetch";

const fetchVerified = wrapFetchWithVerifiedPayment(fetch, walletClient, {
  onMismatch: "throw",        // abort the call if the money mis-settled
  onResourceMismatch: "strict" // abort if a different resource was substituted
});

const res = await fetchVerified("https://some-x402-api.example/paid");

// The verdict rides on a response header as JSON:
const s = JSON.parse(res.headers.get("x-grs-settlement") ?? "{}");
// s.verdict -> "SETTLED" | "UNDERPAID" | "WRONG_RECIPIENT" | "NO_TRANSFER" | "REVERTED" | "UNVERIFIED"
// s.rail    -> "evm" | "svm"
// (or pass { onSettlement: (s) => ... } to get the verdict object via callback)
```

After the payment settles, the wrapper decodes the `PAYMENT-RESPONSE` tx, reads it
from **two independent public RPCs** (cross-confirmed, fails closed on
disagreement), and reconciles the real on-chain transfer against the endpoint's
advertised `payTo` + amount. `SETTLED` is the only verdict that means the money
landed correctly; anything else is surfaced before the agent trusts the paid
response. With `onMismatch: "throw"` a mis-settled call raises instead of
returning a response the agent already paid for.

## What this does that a hosted verifier cannot

Only the **payer** holds the signed `X-PAYMENT` payload and knows the exact URL it
fetched, so only a client-side wrapper can run these:

1. **Signed-payload bind** — the authorization the agent *signed* is bound to the
   nonce consumed on-chain, so a settlement can't be swapped for a different one.
2. **Validity-window check** — the settlement block is checked against the
   authorization's `validAfter`/`validBefore`.
3. **Authoritative resource bind** — the resource actually fetched is compared to
   the one the 402 advertised; a hosted verifier only ever sees a `url` the caller
   *claims*. `RESOURCE_MISMATCH` fires even when the money `SETTLED`.
4. **Transfer/amount/recipient reconcile** — the on-chain value moved vs advertised.

A hosted verify service (e.g. anchor-x402, x402-trust-layer) runs server-side and
sees only the claimed parameters, so checks #1–#3 are structurally impossible for
it. This wrapper is the client, so it has the ground truth firsthand.

## Both rails, full fidelity

The live x402 market is majority Solana (~66% of indexed services). When the
`PAYMENT-RESPONSE` network is `solana:*`, the wrapper reads the Solana chain
directly and reconciles the per-owner **SPL-USDC balance delta** (`post − pre`) —
the canonical settlement signal, unaffected by instruction encoding or inner CPIs
— against the advertised recipient and amount, with the same dual-RPC
fail-closed discipline it uses on Base. One verdict shape across both rails.
(Hosted verifiers that read Solana self-describe their reconcile as "best-effort";
this one is full-fidelity.)

## Use this skill when

- An agent with a wallet auto-pays x402 / HTTP 402 endpoints and must confirm each settlement before acting on the response.
- You are hardening an `@x402/fetch` integration against mis-settlement, replay, wrong-recipient, or resource-substitution.
- You pay x402 services on Solana as well as Base and want one verified-fetch covering both.

## Notes

- Verdicts are point-in-time on-chain reads at settlement time; `UNVERIFIED` means the wrapper could not read a conclusive receipt (surface it, don't treat it as success).
- Default behavior is degrade-open (`onMismatch: "annotate"`) — the verdict rides on the response and the request is never silently broken; opt into `"throw"` to hard-fail.
- Maintained by Grey Ridge Signals. Hosted companion checks (pre-pay screen, receipt audit): https://api.greyridgesignals.ai/x402/preflight
