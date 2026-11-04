# A SETTLED x402 attestation an auditor can recompute, not just trust

There is now an IETF Internet-Draft family for agentic-payment receipts. One of
them, `draft-hopley-x402-settlement-attestation` (revision 01, 16 pages, dated
2026-05-25 on the [IETF datatracker](https://datatracker.ietf.org/doc/draft-hopley-x402-settlement-attestation/)),
specifies a "Categorical Settlement Attestation Format for Agentic-Payment Flows."
It defines a small, closed envelope that records that a payment reached a
particular settlement state, on a particular chain, at a particular instant.

Read the abstract and the stakes jump out. The categorical outcome is not
cosmetic:

> SETTLED triggers settlement-finality record-keeping obligations under EU
> Markets in Crypto-Assets Regulation Article 80 and Anti-Money Laundering
> Regulation Article 56; the PSD2 (Directive 2015/2366) Article 89
> unauthorised-payment refund-window clock begins at SETTLED.

So a single word in the envelope — `SETTLED` versus `PENDING_FINALITY` versus
`REVERSED` — starts regulatory clocks and record-keeping duties downstream. That
word had better be right.

## The gap the draft leaves open on purpose

The draft is deliberately format-only on the hard part. It standardizes the
envelope and the enumeration; it does not standardize how you decide which word
goes in. In its own words, chain finality semantics "are applied at verification
time by a verifier that knows the chain."

That is the honest seam. The envelope is a container. Whoever fills it decides
`SETTLED`. If the emitter self-asserts the state from a single RPC read — or
worse, from the mere presence of a 200 response — the regulatory-grade record is
only as trustworthy as that one emitter's word. A chain reorg, a single flaky
provider, or a `Transfer` event that was never actually authorized can all push
a naive emitter to stamp `SETTLED` when the truthful word was
`PENDING_FINALITY` or `REVERSED`.

The adjacent ecosystem makes this concrete. [ERC-8004](https://blog.quicknode.com/erc-8004-a-developers-guide-to-trustless-ai-agent-identity)
reputation registries — the emerging on-chain trust layer for agents — let any
address attach feedback, and the [Polygon agentic docs](https://agentic-docs.polygon.technology/general/agentic/erc8004)
note you can embed payment proofs such as x402 transaction hashes in the
off-chain feedback file. But a tx hash in a feedback file is a pointer, not a
proof. Nobody in that loop re-derives whether that hash actually settled the
claimed amount to the claimed recipient. The attestation inherits whatever the
emitter asserted.

## Be the verifier that actually knows the chain

Grey Ridge fills exactly that seam. We emit the `draft-hopley` envelope, and the
word we put in `settlement_result` is backed by an independent on-chain
reconcile, not an assertion.

The decision logic is small enough to read in full
(`src/index.ts:11354`):

| Our reconcile verdict | draft-hopley outcome | why |
|---|---|---|
| `SETTLED`, confirmed on **two** independent Base RPCs | `SETTLED` | finality cross-confirmed |
| `SETTLED`, only **one** RPC reachable | `PENDING_FINALITY` | inclusion without independent finality |
| `REVERTED` | `REVERSED` | reversal event, for chain-of-custody audit |
| `UNDERPAID` / `WRONG_RECIPIENT` / `NO_TRANSFER` / `NOT_FOUND` / `UNVERIFIED` | **no attestation** (`null`) | never mint a false settlement |

That single-RPC downgrade to `PENDING_FINALITY` is not a hedge — it is precisely
the "inclusion-without-finality state where the refund-window has not yet
started" the draft describes. We treat one reachable provider as inclusion, two
agreeing providers as finality, and we fail closed when they disagree.

Behind each `SETTLED` sits a four-check reconcile, read-only, across two
independent RPC providers:

1. the settlement tx receipt is fetched and its **USDC `Transfer` events decoded**;
2. those transfers are **reconciled against the endpoint's advertised `payTo`
   and amount** (from its live 402, or a `payto`/`expect` you pass);
3. the **EIP-3009 transfer authorization is cross-confirmed as consumed** in live
   USDC contract state — catching a replayed or forged `Transfer` whose nonce was
   never actually spent;
4. the two providers must **agree**, or the verdict fails closed to
   `UNVERIFIED` and no attestation is minted.

## The part that makes it standards-grade: recompute, don't trust

Emitting the right word is half of it. The other half is that a consumer should
not have to take our word either. Every attestation carries a `content_hash`,
and the envelope rides the sibling canonicalisation draft
`draft-hopley-x402-canonicalisation-jcs-v1` — our `canon_version` is
`jcs-rfc8785-v1`, [RFC 8785 JSON Canonicalization](https://www.rfc-editor.org/rfc/rfc8785).

Concretely, a consumer re-canonicalizes the envelope (dropping `content_hash`)
per RFC 8785, recomputes SHA-256, and it must equal our `content_hash`. The
`settled_payment_ref` is itself a SHA-256 over the JCS canonical form of
`{chain, tx, payTo, amount_minor, from, nonce, result}` (`src/index.ts:11379`),
so the same on-chain settlement always yields the same reference, and any
tampering with the record changes the hash. An ERC-8004 registry, a Vouch-style
trust layer, or an auditor walking the receipt chain does not consume a private
score from us — they consume a byte-deterministic record they can reproduce
digit-for-digit. Our output becomes their input.

## How to consume it

The consume contract is free and keyless:

- **Format descriptor:** `GET /.well-known/x402-settlement-attestation.json` —
  the fields, the canonicalization rule, and the verify instruction, live now.
- **Obtain one:** `GET /x402/receipt-verify?tx=<base-settlement-tx>&url=<x402-endpoint>`,
  read the `attestation` field. Free preview at `/x402/receipt-verify/preview`
  (3 real checks per IP per day); $0.004 for unmetered verification.
- **Discovery:** the `/.well-known/erc-8004.json` registration points to it under
  a `settlement_attestation` extension, so an agent substrate finds the format
  without reading this page.

## Honest scope

This is read-only on-chain reconciliation. It confirms that a specific Base
settlement transaction moved the claimed USDC to the claimed recipient and that
the EIP-3009 authorization behind it was consumed — across two independent
providers, failing closed on disagreement. It does **not** move funds, re-run a
payment, or guarantee the off-chain resource was delivered. `SETTLED` here means
"this payment settled on-chain under a two-provider finality check," not "this
service is safe" and not "this transaction is legally compliant" — the
regulatory obligations the draft lists attach to the fact of settlement, and our
job is only to make the fact of settlement independently checkable. Where only
one provider is reachable we say `PENDING_FINALITY`, not `SETTLED`. Where the
reconcile does not hold, we mint nothing.

That is the whole point of a categorical attestation whose outcome is
load-bearing: the word is only worth something if someone other than the emitter
can recompute it.
