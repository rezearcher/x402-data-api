# A matching USDC Transfer is not proof your x402 payment settled — bind it to the spent nonce

An AI agent pays an x402 endpoint. Later, someone hands you a Base transaction hash and says *"here's the receipt — I paid you."* How do you actually check it?

The common answer, and the one most x402 receipt tooling implements, is: pull the transaction receipt, decode its USDC `Transfer` events, and confirm one of them moved the right amount to your `payTo` address. If it does, mark it SETTLED.

That check is necessary. It is not sufficient. A receipt that matches a real USDC `Transfer` to your address can still fail to prove *this* payment, because a `Transfer` amount and recipient are not unique — they can be reused, re-pointed, or coincidental. The thing that is cryptographically unique to a single x402 payment is the **EIP-3009 authorization nonce**, and amount-match never looks at it.

`GET /x402/receipt-verify` on `api.greyridgesignals.ai` does. It is a read-only, post-payment verifier — the other half of a pre-payment preflight — and it runs four checks, not one.

## The standard x402 verify checklist stops before the receipt

PolicyLayer's x402 reference lists the core checks a facilitator runs for the exact-EVM scheme as **signature validity, amount match, recipient match, and nonce freshness** — and it is careful to separate *verification* (can this payment be executed?) from *settlement* (funds moved). ([PolicyLayer glossary](https://policylayer.com/glossary/x402-payment-verification))

Those checks live at the **facilitator, before settlement**. At settlement the protections are strong and well understood: the USDC contract itself records which EIP-3009 nonces have been consumed and rejects reuse at execution time ([Avalanche x402 security considerations](https://build.avax.network/academy/blockchain/x402-payment-infrastructure/03-technical-architecture/07-security-considerations)), and facilitators such as r402-evm keep an off-chain cache keyed by chain id + nonce that returns a duplicate-settlement error before a second broadcast ([r402-evm facilitator](https://docs.rs/crate/r402-evm/0.20.0/source/src/exact/facilitator/mod.rs)). Double-spending a nonce is not the open problem.

The open problem is **after the fact**. Once a payment has settled and all you hold is a tx hash plus a claim — in an audit, a dispute, an agent-to-agent handoff, a seller reconciling who actually paid — there is no facilitator in the loop anymore. A verifier that only re-matches a `Transfer` amount to your `payTo` will happily bless a receipt that points at a genuine but unrelated transfer to the same address. Nothing binds the receipt back to the specific authorization that this payment used.

## Check #4: decode the AuthorizationUsed nonce, confirm it consumed on-chain

When USDC settles an EIP-3009 `transferWithAuthorization`, it emits `AuthorizationUsed(authorizer, nonce)` and flips `authorizationState(authorizer, nonce)` to true in contract storage. Our verifier:

1. **Receipt present and not reverted** — the tx is mined on Base mainnet and its status is success, or the verdict fails closed.
2. **USDC Transfer reconciliation** — decode the receipt's `Transfer` events and match one against the endpoint's advertised `payTo` + amount (read live from the endpoint's own 402, or passed as `payto`/`expect`). Mismatches resolve to `UNDERPAID`, `WRONG_RECIPIENT`, or `NO_TRANSFER`.
3. **Dual independent RPC** — every on-chain read is run against **two independent Base RPC providers** and **fails closed if they disagree**. One cooperative node cannot fabricate a confirmation.
4. **EIP-3009 authorization bound** — decode `AuthorizationUsed` (topic `0x98de5035…10a5`) out of the receipt, pull the `(authorizer, nonce)`, and call `authorizationState` (selector `0xe94a0102`) on live USDC across the same two providers. The outcome is one of:
   - `consumed` — the nonce reads spent on-chain, cross-confirming the receipt's log against live contract state. The settlement is bound to a spent transfer authorization, not just a matching amount.
   - `state-mismatch` — the receipt carries an `AuthorizationUsed` log, yet the nonce reads **not** consumed on-chain. When both providers agree on that, it is a **forgery signal**, and a would-be `SETTLED` is overridden to `UNVERIFIED`. Fail closed.
   - `not-eip3009` — no `AuthorizationUsed` event (e.g. a direct ERC-20 transfer); the amount reconciliation still stands, with nothing to bind it to, and the response says so.
   - `unverified` — the read could not complete; never upgraded to proven.

The possible verdicts are `SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED`. A dual-confirmed `state-mismatch` is the one that a one-line amount check cannot produce, because it never looked at the nonce.

## Where it sits vs the alternatives

| Receipt check | Amount + recipient match | Dual-RPC, fail-closed | EIP-3009 nonce bound to live state |
|---|---|---|---|
| Facilitator nonce-freshness (pre-settlement) | yes | n/a | at settlement only |
| Typical amount-match receipt verifier | yes | usually single RPC | no |
| `GET /x402/receipt-verify` | yes | yes | **yes — check #4** |

This is not a claim that facilitators are unsafe — they protect the settlement moment well. It is that **receipt verification is a different moment** than settlement, and amount-match is the wrong tool for it.

## Try it without paying

- **Free:** `GET /x402/receipt-verify/preview?tx=<your Base tx>` runs the real four checks under a shared 3-checks-per-IP-per-day trial. No key, no signup.
- **Paid:** `GET /x402/receipt-verify?tx=<tx>&url=<endpoint you paid>` costs **$0.004** in USDC over x402 and returns the full verdict object, including the `authorization` block and the two `rpc_sources` used.
- **MCP:** the `x402_receipt_verify` tool exposes the same verdict to Claude, Cursor, and other MCP clients.
- **In code:** `@grey-ridge/x402-verified-fetch` wraps your existing x402 fetch and reconciles the resulting settlement against the chain over dual RPC as a drop-in layer. (The nonce-binding check #4 above is the hosted route and MCP tool today.)

### Scope, honestly

This is a read-only on-chain audit. It confirms what already settled — it does **not** move funds, re-run a payment, or guarantee the paid resource was delivered off-chain. `not-eip3009` and `unverified` mean exactly what they say, and they are never silently upgraded to proven. It is a settlement-proof tool, not a pentest and not a safety guarantee.

---

*Grey Ridge Signals — payment-verification infrastructure for autonomous agents on Base. Verify before you pay with `/x402/preflight`; prove after with `/x402/receipt-verify`.*
