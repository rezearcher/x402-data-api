# x402's facilitators are the trust bottleneck — USENIX tested 15, all 15 failed

If your agent pays over x402, one third party decides whether the payment was valid and then triggers the on-chain settlement: the **facilitator**. That single component is where the protocol centralizes its trust — and a USENIX Security 2026 study just measured how well that trust holds up in the wild.

## The finding

In *"When HTTP 402 Meets the Blockchain: Risks on Emerging x402 Payments"* (arXiv:2607.19545, Qinying Wang, Yong Yang, Yuan Chen, Shouling Ji, Mathias Payer; USENIX Security 2026, submitted 21 July 2026), the authors:

- defined **8 security rules** a correct facilitator must enforce,
- derived **4 attack types** — **Free Shopping**, Asset Theft, Service Denial, and Gas Abuse,
- built a black-box tester and ran it against **15 real facilitators**, and
- found **rule violations in all 15**, cross-checked against **119M+ Base and Solana transactions**.

Not "most." All fifteen. The thing that decides whether your money was correctly taken is, empirically, the least-tested surface in the stack.

## Free Shopping, concretely

The attack that matters most for a payer is **Free Shopping**: a validation or parsing gap lets the amount that actually settles **on-chain** diverge from the amount the facilitator's off-chain check approved. The service still hands over the resource. You paid — but not what the endpoint advertised, or not to whom it advertised. And here is the uncomfortable part: **you cannot see it before you pay.** A pre-payment check reads the *advertised* terms; Free Shopping is a gap between those terms and what the chain actually recorded. It is only observable **after settlement**, by comparing the two.

## What the current tools check — and don't

The security packages shipping for x402 today harden the **facilitator** or re-confirm a payment at the moment it is made:

- **`@furlpay/x402-guard` (v0.2.0, live on npm)** describes itself as *"Facilitator-layer hardening for x402 agentic payments."* Its first keyword is literally `facilitator`. It makes the facilitator stricter.
- Receipt "auditors" in the wild typically confirm that **a transaction hash exists** and that a payment event fired.

Both are useful. Neither answers the Free-Shopping question, because both still **trust the facilitator's own verdict**. If the facilitator is one of the 15, hardening it or reading back its own receipt inherits its blind spot. Nobody in that layer re-derives the **settled amount from the chain itself** and reconciles it against what the endpoint advertised.

That reconciliation is the whole job of our check — and it is deliberately **not** in the facilitator's layer.

## What `/x402/receipt-verify` does

`GET /x402/receipt-verify` ($0.004 — 4000 atomic USDC, asset `0x8335…2913`, network `eip155:8453` / Base, payable to the wallet in the live 402) takes a settled Base tx plus the resource URL and:

1. reads the real USDC `Transfer` to the advertised `payTo` from **two independent Base RPC providers**,
2. reconciles the **settled atomic amount** against the **advertised** amount, and
3. emits a named **`facilitator_consistency`** verdict:

| verdict | meaning |
|---|---|
| `CONSISTENT` | settled == advertised within tolerance — the facilitator's verify and the chain agree |
| `SETTLE_DIVERGENCE` | they differ — `direction: under_settle` (the Free-Shopping case: chain moved less than advertised) or `over_settle` (chain moved more) |
| `UNVERIFIED` | no settled transfer to `payTo`, no advertised amount, a cap-style price, or **the two RPCs disagree — we fail closed** |

Live, right now, on our own settled receipt sample:

```
verdict: CONSISTENT
advertised_atomic: 4000
settled_atomic:    4000
delta_atomic:      0
direction:         match
```

The pre-payment cousin, `GET /x402/preflight` ($0.001), names the same axis before you spend — it returns `facilitator_consistency: UNVERIFIED (pre-payment)` on purpose, telling you plainly that divergence is only knowable after settlement, and points you here. Honesty by construction, not by footnote.

## Scope — what this is and is not

This is a **read-only, post-settlement reconciliation**. It confirms what the chain already recorded and compares it to the advertised terms. It does **not** move funds, re-run a payment, or guarantee the resource was delivered off-chain — and it is not a pentest or a "safe" stamp. The labels we use internally for the mechanism (`class-1`, verify/settle divergence) are *our* naming; the paper's own term for the attack is **Free Shopping**. The dual-RPC design exists so that a single lying or lagging node can't fake a `CONSISTENT` — if the two providers disagree, you get `UNVERIFIED`, never a green light.

## Try it

```bash
# pre-payment: name the axis before you spend ($0.001)
curl -s https://api.greyridgesignals.ai/x402/preflight/preview | jq .facilitator_consistency

# post-payment: reconcile a settled Base tx against the advertised terms ($0.004)
curl -s "https://api.greyridgesignals.ai/x402/receipt-verify?tx=<your_base_tx>&url=<the_resource_url>"
```

For scale: `@x402/fetch` did **694,719 downloads last month**. Every one of those agents pays through a facilitator the USENIX authors would classify as untested-until-now. The check that doesn't trust that facilitator is one call away.
