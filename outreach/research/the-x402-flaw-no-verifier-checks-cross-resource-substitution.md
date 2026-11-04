On 29 May 2026 six researchers from City University of Hong Kong, Zhejiang University, and CUHK published *Free-Riding in the AI Economy: Demystifying Logic Flaws in x402-Enabled Payment Systems* ([arXiv:2605.30998](https://arxiv.org/abs/2605.30998), Ling, Huang, Chen, Zhou, Wu, Wang). They disclosed the findings to Coinbase and ThirdWeb. Against production x402 middleware they measured up to **97.76% unpaid computation** — work delivered that nobody paid for.

The headline flaw is the one their abstract names first: **cross-resource substitution** — *"a semantic gap in signature design enabling cross-resource substitution, where payment proofs are transplanted to other unauthorized contexts."* In plain terms: an x402 payment signed for a cheap resource can be replayed as proof-of-payment for a different, more expensive resource at the same price and merchant.

## Why every x402 verifier on npm misses it

x402's `exact` scheme signs an EIP-3009 transfer authorization over six fields: `from`, `to`, `value`, `validAfter`, `validBefore`, and a `nonce`. It does **not** sign the resource. The signature binds funds to a merchant address and an amount — not to *what you bought*.

So when a verifier confirms a settlement, the strongest thing it can honestly say is "someone sent `amount` USDC to `payTo`." That is exactly where the shipping tools stop:

- **thirdweb `verifyPayment`** takes `payTo`, `price`, `network` and returns a status — recipient and amount.
- **`@x402-checkpoint/sdk` 2.1.0** verifies against payment requirements (`payTo`, `amount`) and returns a `valid` flag + settlement hash.
- **`@openfacilitator/sdk` 1.0.0** verifies then settles against the same requirements.

Each is correct about what it checks. None of them answers the paper's question: *is this settlement uniquely attributable to the resource I paid for, or is it transplantable to any same-`(payTo, amount)` resource?* A payment proven for `/cheap` silently validates as proof for `/expensive`.

## The verdict we added

`GET /x402/receipt-verify` now returns a `resource_binding` field. Pass the settlement tx **and** the URL you actually paid, and it reads the live 402 that URL serves, extracts the `resource` the challenge declares, and reconciles it against your URL:

- **`DECLARED`** — the live 402 declares a resource matching the URL you paid. The seller asserts this payment is for this resource.
- **`RESOURCE_MISMATCH`** — the declared resource is a *different* resource than the URL you verified. Fail-closed: we do not treat the settlement as proof of payment for your URL.
- **`SUBSTITUTABLE`** — the 402 declares **no** resource field, so nothing beyond `(payTo, amount)` ties the settlement to anything. The same on-chain payment would reconcile-validate as proof for *any* resource sharing that recipient and price.
- **`UNVERIFIED`** — no URL supplied, or no live 402 could be read. The payTo+amount reconciliation still stands; the binding simply isn't assessed.

## The honest part (we say it in every verdict)

A `DECLARED` binding is a **challenge-level declaration, not a cryptographic one**. Because the `exact` scheme never signs the resource, no verifier — not us, not the facilitator — can cryptographically prove which resource a settlement paid for. What we *can* do is cross-check the resource the live endpoint declares against the one you paid, and fail closed on a mismatch or an absent declaration. The live verdict says so verbatim:

> x402's exact scheme signs (from, to, value, validAfter, validBefore, nonce) but NOT the resource, so this is a challenge-level declaration, not a cryptographic binding.

That caveat is the point. Claiming a cryptographic resource bind would be false; surfacing the exact residual exposure is the useful thing.

## Where this sits in the paper's taxonomy

The Ling et al. paper names five issues. Our read-only settlement verifier now covers three of them, each honestly scoped:

| Paper's flaw | What we check |
|---|---|
| Cross-resource substitution | `resource_binding` — declared-resource reconcile, fail-closed |
| Probabilistic service duplication | EIP-3009 `AuthorizationUsed` nonce vs live `authorizationState`, cross-confirmed on two Base RPCs |
| Denial of settlement | dual-RPC reconcile, fail-closed if the two providers disagree |

We do **not** claim allowance-overdraft or TOCTOU coverage — those live in the merchant's own concurrency logic, and the paper found official Coinbase SDKs already resisted TOCTOU.

## Try it — keyless, read-only, no account

```
curl "https://api.greyridgesignals.ai/x402/receipt-verify/preview?tx=<0xhash>&url=<the x402 resource you paid>"
```

Free preview, 3 real checks per IP per day. Unmetered verification is `GET /x402/receipt-verify` ($0.004, pays inline over x402). Live on both `api.greyridgesignals.ai` and the `x402-data-api.sigrunner.workers.dev` host.

**Scope, plainly:** this reconciles a Base-mainnet settlement against an endpoint's advertised payTo + amount and cross-checks the resource the live 402 declares. It confirms what already settled on-chain — it does not move funds, re-run a payment, or guarantee the resource was delivered off-chain. It is a detection-and-reconciliation tool, not a pentest and not a guarantee.

The agent-payment developer audience is real and growing: `@x402/fetch`, the reference client, pulled **694,719 downloads** in the last month (npm, 2026-10-05 to 2026-11-03). As that volume compounds, "I verified the amount hit the right address" stops being enough. The paper named the gap; this is the check for it.
