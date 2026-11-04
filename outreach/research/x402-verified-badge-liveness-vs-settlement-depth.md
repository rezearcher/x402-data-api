A $1 "verified" badge for an x402 endpoint has become table stakes. Pay once, get a 30-day signed certificate and an SVG badge for your docs. It is a good idea and it works — but read what the audit behind the badge actually checks, because most of them certify the same narrow thing: *is the endpoint up?*

x402station's verified badge — the one most sellers reach for — grades liveness. Per [its own spec](https://x402station.io/spec) and [verified page](https://www.x402station.io/verified), the audit wants at least 20 probes in the last 7 days, `uptime_7d_pct ≥ 95%`, a p99 under 5,000 ms, and a price inside the $0.0001–$5 band; the "verified+" tier additionally confirms at least one paid call occurred in the last 30 days. That is a real, honest signal — uptime and a healthy 200/402 handshake, re-checked on every badge render. (Those criteria are the operator's own description, worth reading at the source before you build against them.)

But notice what a liveness audit *structurally cannot* answer, no matter how many probes it runs:

- When your endpoint returns a `402` quoting a `payTo` address and a price, **does a real payment actually land at that address, for that amount?** "verified+" confirms *some* paid activity exists — not that a specific settlement reconciled to the address you advertise.
- Is the price you quote the price your `402` returns right now, or has it drifted?
- Does your paid response actually deliver the resource shape your challenge promised — or does the resource leak on an unpaid request?
- Is the `payTo` address itself clean of OFAC/scam-list flags?
- Does your endpoint's own copy carry a prompt-injection payload (LLM01/LLM08) that would hijack the buyer's agent?

None of those are uptime. They are the *depth* axis — and that is the half we certify.

## Two different certificates

`GET /x402/cert?url=<your-endpoint>` is a paid seller-side deep certificate: **$1.00 USDC on Base, paid inline over x402, no account.** It returns a dated, HMAC-signed, 30-day attestation — `did:web:api.greyridgesignals.ai` as issuer — over six depth tiers, so a buyer can verify the certificate independently rather than taking your word (or ours) for it:

| tier | what it certifies | a liveness audit checks it? |
|---|---|---:|
| `live` | endpoint returns a valid x402 `402` challenge | yes |
| `reliable` | consistent settle across a burst of probes | yes |
| `price_accurate` | advertised price **matches** the live `402` amount | no |
| `delivery_specified` | paid response declares its output; no unpaid leak | no |
| `injection_safe` | zero LLM01/LLM08 injection findings in endpoint copy | no |
| `payto_clear` | `payTo` passes OFAC + community scam screening | no |

Grade is `deep-verified` only when all six pass. The first two overlap with a liveness badge; the last four are the gap.

## The piece no uptime probe can fake: on-chain settlement proof

Add `&tx=<a real Base settlement hash for a paid call to your endpoint>` and the certificate earns a separate **`settlement-proven`** badge. We read that transaction's receipt from **two independent Base RPC providers** (`mainnet.base.org` and `base-rpc.publicnode.com`), decode the USDC `Transfer` events, and reconcile them against the `payTo` and amount your endpoint advertises in its *live* `402`:

- both RPCs reachable **and agree** → `dual-confirmed`
- both reachable **and differ** → verdict `UNVERIFIED` (`rpc-disagreement`) — we fail **closed** rather than trust one source
- only one reachable → `single-source`, degrade-open and disclosed in the `confirmation` field

A genuine `SETTLED` verdict proves your endpoint actually moved USDC to the address it advertises — confirmed across two providers, failing closed on any disagreement. A `&tx` that doesn't reconcile never blocks or forges the certificate; it is simply recorded as unproven. This is the one claim an uptime/p99 probe can never make: not "it was up," but "it settled, to the address it said, and two independent views of the chain agree."

## Honest scope

This is not a pentest, not a guarantee, and it never says your endpoint is "safe." `injection_safe` is static LLM01/LLM08 detection over your endpoint's text, not a dynamic exploit test. `delivery_specified` is pre-payment readiness — it confirms your challenge declares an output and doesn't leak on an unpaid request; it does not guarantee off-chain delivery after a real payment. The settlement check is read-only: it confirms what already settled on Base, reconciled dual-RPC — it does not move funds, replay a payment, or vouch for anything that happened off-chain. Those are the limits, stated up front.

## Try it before you pay for it

- Free, point-in-time badge: `GET /x402/badge?url=<endpoint>` — renders the current verdict, no persisted certificate.
- Free settlement check on your own real tx: `GET /x402/receipt-verify?tx=<0x…>&url=<resource>` (3/IP/day) — the same dual-RPC reconciliation the `settlement-proven` badge runs.
- Any buyer can verify an issued certificate free: `GET /x402/cert/verify?id=<cert_id>`.
- Mint the full deep certificate: `GET /x402/cert?url=<your-endpoint>` ($1.00, x402 inline) — add `&tx=<hash>` for the settlement-proven badge.

If the whole value of a trust badge is that a buyer can believe it, then the badge should certify the thing a buyer is actually risking money on: that paying you sends USDC to the address you advertise. Uptime is necessary. It isn't that.
