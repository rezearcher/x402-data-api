An x402 service answers a `402` with an `accepts[]` block: here are the chains, assets, and addresses you may pay me on. An agent reads that block, picks a rail it can sign, and sends USDC. The quiet assumption is that every row in `accepts[]` is a path the seller can actually *honor*. That assumption is wrong more often than it should be, and the agent only finds out after the money has moved.

So we shipped a route that publishes the honest answer and proves it against our own setup.

## The gap: "the facilitator supports it" is not "I can be paid on it"

There are two different questions, and they get conflated:

1. **What can the rail route?** This is what a facilitator's supported-networks list tells you. Fireblocks exposes a public `GET /api/payments/supported` that reports the scheme-and-network pairs the facilitator accepts ([Fireblocks x402 reference](https://developers.fireblocks.com/docs/x402-protocol-reference)). Coinbase's CDP facilitator has its own supported set.
2. **What can *this seller* actually honor?** A facilitator can route Solana USDC all day — but if the seller holds no Solana receive address, every Solana row in its `accepts[]` is a dead path. The facilitator's list can't see that; only the seller can.

Solana's own x402 facilitator guidance is explicit about the risk from the first question: a seller should **not advertise a payment option until the selected facilitator confirms support for that exact version, scheme, and network** ([solana.com x402 facilitator docs](https://solana.com/docs/tools/x402-facilitator)). We take it one step further — we intersect facilitator support with the addresses we actually hold, and publish only the overlap.

## The probe: `GET /x402/networks`

One keyless GET, no payment, returns our live settlement capability straight off the facilitator — `source: "cdp-facilitator-live"`, `as_of: 2026-11-04T23:34:10Z`:

| | What the CDP facilitator **supports** | What Grey Ridge can **honor** |
|---|---|---|
| **EVM** | Base, Base Sepolia, Polygon, Arbitrum One, World Chain, World Chain Sepolia, Monad | all 7 — we hold a Base receive address |
| **Solana (SVM)** | `solana` mainnet + devnet | **none — we hold no Solana address** |

`can_settle` comes back `{ base: true, solana: false }`. `receive_addresses` comes back `{ base: true, solana: false }`. Our advertised `settlement_networks` list contains the seven EVM networks and **omits Solana entirely** — even though our facilitator supports it.

That omission is the whole point. The lazy, and dishonest, move is to copy the facilitator's full supported list into your `accepts[]` so you look multi-chain. We don't. The endpoint's own note says it plainly:

> settlement_networks = facilitator-supported networks intersected with networks we hold a receive address for. We never advertise a settlement path we cannot honor. Base USDC is always available.

You can check the claim yourself — the facilitator's SVM support and our `solana: false` are both in the same JSON response. If we were padding our chain list, that contradiction is where you'd catch us. It isn't there.

## Why an agent should care

A practitioner's seller-side rule for x402 is to **refuse or hold settlement when the token or network doesn't match your published `accepts`** — treat a mismatch as unpaid. The failure this prevents is concrete: an agent reads a chain in `accepts[]`, signs a payment authorization for it, and the settlement either stalls or lands somewhere the seller can't reconcile. Fireblocks even documents a `x402 payments sync` command for payments **stuck in a settling state** — reconciliation after the fact, for money already in flight.

A capability probe moves that check *before* the money moves. An agent (or its risk layer) can `GET /x402/networks`, confirm the chain it intends to pay on is in `settlement_networks`, and skip any service whose advertised rails it can't verify. That is exactly the kind of pre-payment safety check our paid `/x402/preflight` and `/x402/receipt-verify` routes are built around — this one is free and needs no signature.

## Scope, honestly

This is a **capability** probe, not a settlement guarantee for any individual transaction. It tells you which rails the seller can honor right now; it does not promise a specific transfer will confirm, and it is not financial or security advice. `source: "cdp-facilitator-live"` means the network list is read from the facilitator at request time, not hard-coded. Base USDC is always in the set because that is the address we hold. The day we add a Solana receive address, `can_settle.solana` flips to `true` on its own and Solana appears in the list — no copy, no claim ahead of the capability.

Try it: `curl https://api.greyridgesignals.ai/x402/networks`
