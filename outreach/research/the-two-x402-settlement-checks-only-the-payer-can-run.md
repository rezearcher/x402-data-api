# The two x402 settlement checks only the payer can run

An autopaying agent gets one piece of ground truth after it pays an x402 endpoint: the `PAYMENT-RESPONSE` header carrying an on-chain transaction hash. Everything before that — the 402 quote, the conformance preflight, the budget cap, the prompt-injection screen — happens *before* money moves. The moment that matters, the settlement itself, is the moment almost nothing verifies.

The current crop of x402 fetch wrappers is honest about where it stops. Reading their own npm descriptions (registry, 2026-11-03):

- **`agent-receipt-verify`** — *"Checks x402 endpoint conformance **before an agent pays**, and links the receipt to its settlement."* (zero runtime dependencies)
- **`x402-safe-fetch`** — *"checks an unknown x402 endpoint ... **before paying it**, and never pays above your budget."*
- **`settled-x402`** — *"Checks each quote against Settled's independent evidence ... **before it is signed**."*

These are good tools. They are also, by their own wording, pre-payment. None of them pulls the settlement transaction from an RPC node and reconciles it against the quote the endpoint advertised. A matching 30-day download picture — 4,685 / 3,352 / 2,522 — against the 671,132 downloads/month of Coinbase's own payer client `@x402/fetch` shows how many paying agents run with *no* post-payment chain read at all.

## The four-check settlement standard

Reconciling a settlement is not one check. It is four, and they are not equally powerful:

| # | check | what it proves | who can run it |
|---|-------|----------------|----------------|
| **3** | Transfer reconcile | a USDC `Transfer` to the advertised `payTo` for ≥ the advertised amount exists in the tx | anyone reading the chain |
| **2** | EIP-3009 nonce consumed | the USDC `AuthorizationUsed(authorizer, nonce)` log cross-confirms against a live `authorizationState() == consumed` call — binds the settlement to a *spent* transfer authorization, catching a replayed transfer to the same `payTo` | anyone reading the chain |
| **1** | signed-payload bind | the nonce consumed on-chain is **exactly the one this client signed** in its `X-PAYMENT` — the settlement is of *our* payment, not a coincidentally-matching one | **only the payer** |
| **4** | validity window | the settlement block's timestamp falls inside the authorization's signed `[validAfter, validBefore]` window | **only the payer** |

Check #3 is the one everyone means by "reconcile": did a transfer of the right size reach the right address? Necessary — but a server that hands you a *real* transaction hash for a *different* payment to the same `payTo` passes #3 cleanly. Check #2 raises the bar: it confirms, across two independent Base RPC nodes, that an EIP-3009 authorization nonce was actually consumed, so a recycled plain transfer to a known `payTo` no longer blesses as settled.

Checks **#1 and #4 are the depth no hosted verifier can offer** — including Grey Ridge's own hosted `/x402/receipt-verify`. They require the signed EIP-3009 authorization, and only the paying client holds it. A third-party service you hand a tx hash to can reconcile the chain (#3, #2), but it cannot know whether the consumed nonce is the one *you* signed, because it never saw your `X-PAYMENT` payload. That is not a feature gap a hosted API can close with more engineering; it is structural. The payer is the only party in the protocol that can bind its own signature to the settled transaction.

## What we shipped

`@grey-ridge/x402-verified-fetch` **0.3.0** is a drop-in `fetch` wrapper that *is* the payer. It composes Coinbase's `@x402/fetch` → `wrapFetchWithPayment` (the 671k-downloads/month client) rather than replacing it, captures the `X-PAYMENT` payload that client signs, and runs all four checks against the settlement the endpoint reports — over plain JSON-RPC, with zero RPC SDK (`viem`/`ethers` not required) and no account.

```ts
import { wrapFetchWithVerifiedPayment } from "@grey-ridge/x402-verified-fetch";
const fetchVerified = wrapFetchWithVerifiedPayment(fetch, client);
```

The verdict is on-chain ground truth, one of:

```
SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED
```

It **fails closed** — a strict agent is never told a bad settlement is `SETTLED`:

- amount matches but the authorization is **not** consumed on-chain (dual-confirmed) → `UNVERIFIED` (check #2, replay/forgery);
- the consumed nonce is **not the one we signed** → `UNVERIFIED` (check #1, `payloadBind.status: "mismatch"`);
- the settlement mined **outside** the signed validity window (dual-confirmed block time) → `UNVERIFIED` (check #4, `payloadBind.status: "window-violation"`).

A direct (non-EIP-3009) transfer degrades open and *says so* — `authorization.status: "not-eip3009"`, `payloadBind.status: "unbound"` — rather than silently claiming a bind it cannot make. The nonce bind is the authoritative link: a consumed EIP-3009 nonce is unique to the authorization that produced it, so a signed-nonce match is an unforgeable tie between your signature and the settled tx. It is deliberately **not** a full secp256k1 signature recovery — that would need a crypto dependency this dep-free wrapper avoids, and the consumed-nonce equality already carries the proof.

35 tests cover the matrix (reconcile verdicts, nonce-consumed cross-confirmation, payload bind, window checks, fail-closed vs degrade-open). Install today over git while npm trusted-publishing for the `@grey-ridge` scope finishes setup:

```bash
npm install github:rezearcher/x402-verified-fetch
```

## Honest scope (Claims Law)

A `SETTLED` verdict confirms the on-chain settlement went to the right address for the right amount, bound to the authorization this client signed. It does **not** prove the off-chain resource was delivered, nor that its content is correct — later settlement failure or cache reuse is a separate failure mode. A settlement proof is not a delivery guarantee. Checks #1 and #4 are payer-only by construction; they do not make a hosted verifier worse, they describe a depth a hosted verifier cannot reach. Everything above traces to the package source (`src/authz.ts`, `src/index.ts`) and live npm registry figures as of 2026-11-03.
