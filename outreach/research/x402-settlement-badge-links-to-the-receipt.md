Most "trust" artifacts in x402 are a paragraph you have to believe. A facilitator says a payment settled; a Trust Card says an endpoint passed a check; a receipt arrives in a `PAYMENT-RESPONSE` header. VouchSpec puts the problem plainly in [its own spec](https://vouchspec-sandbox.plyrium.com/vouchspec): a settlement receipt is *"a chain of claims, not a badge."* True — a header full of claims is not something your readers can see, and it is not something that markets you.

So we did the obvious thing the other way around: we turned the reconciled on-chain receipt **into the badge**, and made the badge click straight through to the Base transaction.

## What the badge actually renders

When you mint a deep certificate for your endpoint with `GET /x402/cert?url=<your-endpoint>` ($1.00 USDC on Base, paid inline over x402, no account) and pass `&tx=<a real Base settlement hash for a paid call to your endpoint>`, the mint response's `badge_embed_markdown` is not a static SVG. It is a clickable badge:

```
[![x402 deep-certified](https://img.shields.io/endpoint?url=...%2Fx402%2Fcert%2Fbadge%3Furl%3D...)](https://basescan.org/tx/0x<your-settlement-tx>)
```

Two things happen that an assert-only badge cannot do:

1. **The badge message renders the settled block inline** — it reads `settlement-proven ✓ · Base blk <n> · to <expiry>`, not a generic "verified." A reader sees the block number on the badge itself and can look it up.
2. **The image is wrapped in the Base receipt link.** Click the badge in your README and it opens `basescan.org/tx/<your-settlement-tx>` — the real USDC transfer to your advertised `payTo`. The proof is one click from anyone who sees the badge.

The mint response also carries the proof as structured data, not just pixels — `onchain_proof` returns `{ tx, block, amount_usdc, payTo, confirmation, rpc_sources, basescan_url }`, so an agent reading your docs can verify the claim programmatically instead of trusting the picture.

## Why the receipt behind it is trustworthy

The badge only earns `settlement-proven` if the transaction reconciles. We read that receipt from **two independent Base RPC providers** (`mainnet.base.org` and `base-rpc.publicnode.com`), decode the USDC `Transfer` events, and reconcile them against the `payTo` and amount your endpoint advertises in its *live* `402`:

- both RPCs reachable **and agree** → `dual-confirmed`
- both reachable **and differ** → verdict `UNVERIFIED` (`rpc-disagreement`); we fail **closed** rather than trust one source
- only one reachable → `single-source`, degrade-open and disclosed in the `confirmation` field

A `&tx` that does not reconcile as a SETTLED USDC payment to your advertised `payTo` never forges a badge and never blocks the depth certificate — it is simply recorded as unproven. The block number only renders when we actually read it; when it is null the badge degrades to the plain depth grade rather than fabricating a number.

## Where this sits next to the others

| artifact | public, embeddable badge? | reads the chain? | clicks through to the receipt? |
|---|---:|---:|---:|
| Facilitator "settled" response | no | n/a (its own word) | no |
| AgentMint Verify "Trust Card" | card | no — [verifies x402/MPP challenges without paying](https://www.producthunt.com/products/agentmint-verify/makers) | no |
| AFX-style $1 liveness badge | yes | no (pre-pay criteria) | no |
| VouchSpec `PAYMENT-RESPONSE` proof | [explicitly "not a badge"](https://vouchspec-sandbox.plyrium.com/vouchspec) | yes | no |
| 402Proof signed receipt | token | yes (XRPL tx hash) | links XRPL, not Base |
| **Grey Ridge `settlement-proven` badge** | **yes** | **yes, dual-RPC Base, fail-closed** | **yes — image links to basescan** |

The gap we fill is narrow and specific: a badge that is *both* a public artifact you embed in a README *and* a one-click window into the real Base receipt it stands for. That is the difference between telling your buyers you settle and letting them watch the money land.

## Honest scope

This certifies the depth axis, not a pentest and not a guarantee, and it never says your endpoint is "safe." The settlement check is **read-only**: it confirms what already settled on Base, reconciled across two RPC providers, failing closed on any disagreement. It does not move funds, replay a payment, or vouch for anything that happened off-chain after settlement. The depth certificate's other tiers — `injection_safe` is static LLM01/LLM08 detection over your endpoint's text, `delivery_specified` is pre-payment readiness — are declared limits, not exploit tests.

## Try it before you pay

- Free settlement check on your own real tx: `GET /x402/receipt-verify/preview?tx=<0x…>&url=<resource>` (free, 3/IP/day) — the same dual-RPC reconciliation the badge runs.
- Free point-in-time badge: `GET /x402/badge?url=<endpoint>` — current verdict, no persisted certificate.
- Any buyer can verify an issued certificate free: `GET /x402/cert/verify?id=<cert_id>`.
- Mint the full deep certificate: `GET /x402/cert?url=<your-endpoint>` ($1.00, x402 inline) — add `&tx=<hash>` to earn the clickable `settlement-proven` badge.

If a trust badge is worth anything, it is because a stranger can check it. Put the receipt one click behind the badge, and they can.
