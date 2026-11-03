# Your x402 price checker says the price matches. It still can't see a leaking paywall.

*How to catch an x402 endpoint that hands out its paid resource for free — before your agent pays for it — with a zero-capital, pre-payment delivery-readiness check.*

There is a whole tier of x402 trust tooling now. It will fetch an endpoint once, validate the `HTTP 402` challenge, read the network / asset / `payTo` / amount, and tell you whether the **advertised price matches the listed price**. That is a real, useful check. It is also the *cheapest* question to answer, and it leaves the question your agent actually cares about on the table:

**If I pay, do I get something — or is this endpoint already handing the resource out for free while its manifest still advertises a price?**

A price-match check cannot answer that. A broken or mis-configured paywall is, by construction, a case where the *price is correct* and the *gate is open*. The number is right; the door is unlocked. Your agent pays $0.004 for a byte stream the endpoint was already serving to an unpaid `GET`.

We added a seventh check to [`/x402/preflight`](https://api.greyridgesignals.ai/x402/preflight?ref=greyridge) that looks for exactly this: **delivery readiness.** It is pre-payment, read-only, and costs no capital. Here is what it does, what it deliberately does *not* claim, and how it sits honestly next to the tools already in this space.

---

## The gap, stated precisely

Run an unpaid request at an x402 endpoint and one of three things happens:

1. **It answers `402` with a well-formed challenge.** Normal. The paywall is closed; you have not paid; you got no resource. Good.
2. **It answers `2xx` with a real payload** — and its own `/.well-known/x402` manifest still advertises a *positive* price. That is a **leak**: the gate is open, you may be about to pay for data it already serves free.
3. **It answers `2xx` with a payload and has no advertised price** (or an advertised price of `0`). That is just a **free API**. Not a leak. Nothing to flag.

The entire trick is telling case 2 apart from case 3 — and you can only do it by cross-referencing *what the unpaid request returned* against *what the endpoint's own manifest says it charges*. A price-vs-listing checker never makes that join, so it cannot raise the leak. It sees a `2xx`, shrugs, and moves on.

Our delivery axis makes the join. The verdict function is pure and unit-tested:

```
computeDelivery(servedUnpaidData, selfAdvertisedAtomic, outputSpecified)
  → LEAK        if servedUnpaidData AND selfAdvertisedAtomic > 0
  → SPECIFIED   else if the challenge declares an output shape
  → UNVERIFIED  otherwise
```

`LEAK` requires **both** conditions. A legitimately free API (`selfAdvertisedAtomic === 0`) is **never** mislabelled a leak. If we can't find the endpoint's advertised price at all, we degrade open to `UNVERIFIED` — we never guess a leak we can't substantiate.

### The verdict matrix, reproduced from the code

Output of `computeDelivery` over the five real input shapes (run against `src/index.ts` this week):

| unpaid request returned data? | endpoint's own advertised price | output shape declared? | **verdict** |
|---|---|---|---|
| yes | 0.004 USDC (4000 atomic) | no | **LEAK** |
| yes | 0 (free API) | yes | SPECIFIED |
| yes | unknown (not found) | no | UNVERIFIED |
| no (clean `402`) | — | yes | SPECIFIED |
| no (clean `402`) | — | no | UNVERIFIED |

When the verdict is `LEAK`, the check fails with a concrete fix hint: *"treat as mis-priced/mis-gated — do not pay for a resource the endpoint already serves free."* And because a leak can only surface on a **non-402** response, the endpoint already failed the "will it settle" gate, so the overall verdict is `AVOID` — your agent routes around it automatically.

The second signal, `output_specified`, is softer and honest about it: does the challenge or manifest declare the *shape* of what you buy (`outputSchema`, `output`, `example`, `examples`, `responseSchema`, or `returns`, checked at the top level, inside `accepts[]`, and inside `accepts[].extra`)? If not, the verdict is `UNVERIFIED` — informational, **never a block**. Paying blind is a smell, not a crime, and we score it as a smell.

---

## Where this sits next to the tools already doing x402 trust

We are not the first to fetch-once-and-grade an x402 endpoint, and we won't pretend to be. Here is the honest layout.

**ttimesai's x402 Endpoint Checker** (Apify; validation logic from the open-source *Delivery Score* project, which has probed 15,498 of 32,585 Bazaar endpoints — ~48% coverage) does the price-and-listing job well: availability, challenge validity, payment terms, and whether the live `payTo`/price match the Bazaar listing. On the delivery question it is admirably blunt in its own words:

> *"It cannot tell you whether the seller actually delivers after payment; that needs a real purchase."*

It even has a `no_payment_required` status for a `2xx`-without-payment — but, per its own docs, it does not assess whether data was *exposed* in that case, and it does not join that `2xx` back to the advertised price to call it a leak. That join is the gap we fill. *(2 total users / 1 monthly on Apify at time of writing — this lane is wide open.)*

**Lumière PayCheck** (Glama) goes the *other* way and actually verifies delivery — but it does so with **real test payments**, monitoring endpoints every 30 minutes. That is the gold standard for *post-payment* proof, and it costs capital to produce. It is read-only and free *for the caller*, but someone is paying for those test purchases.

**Where we fit:** the pre-payment, zero-capital middle. We catch the **open-paywall leak** a price check structurally misses, and we tell you whether the output shape is declared — **without paying anyone**. We are explicit that this is *not* post-payment proof: true delivery after settlement is only provable from **your own on-chain settlement receipt** once you've paid. We say so in the response's `scope_note`, every time:

> *"static 402 wire-format + liveness + LLM01/LLM08 description scan + payTo OFAC/scam flag + advertised-vs-charged price-accuracy + delivery-readiness (broken-paywall / output-spec) check; read-only, never pays; not a settlement guarantee."*

Use all three. A price-match check, an open-paywall/leak check, and a paid delivery monitor answer three different questions. We built the one in the middle that nobody else runs.

---

## The economics (why a sub-cent check is rational)

`/x402/preflight` costs **$0.001 per call** (keyless free preview, or $0.001 live; computed from the live `accepts[].amount = 1000` at 6-decimal USDC). Checking it before you pay a $0.004 seller:

- The check is **25%** of the payment it guards.
- If it catches **one** leak — a resource you'd have paid $0.004 for while it was served free — the check pays for itself **4×**.
- Put differently: one missed $0.004 open-paywall payment equals **4** preflight checks. For any agent paying more than four unknown endpoints, running the check first is strictly cheaper than eating a single mis-gated payment.

And it composes with the other six checks in the same call — will-it-settle (402 + `accepts[]`), safe-to-pay (OFAC/scam `payTo` screen + LLM01/LLM08 description scan), price-accuracy (advertised vs live), an optional reliability burst, and now delivery readiness — one fetch, one `PAY | CAUTION | AVOID`.

---

## If you're the seller, not the buyer

The uncomfortable version of this post: **run the delivery check against your own endpoint.** An open paywall is a silent revenue leak — you advertise a price, a crawler or a mis-routed path serves the resource unpaid, and you never see the `402` fire. A buyer's preflight (or a scanner's) will catch it before you do. Point the check at your own `/.well-known/x402`-advertised routes; if any come back `LEAK`, your gate is broken somewhere upstream. For continuous coverage, the same signal feeds [Grey Ridge's hosted monitoring](https://api.greyridgesignals.ai/for-agents?ref=greyridge) so a paywall that starts leaking after a deploy trips an alert instead of bleeding quietly.

---

## Try it (no key, no payment)

```bash
# zero-capital preview — never pays, returns the full verdict incl. delivery
curl -s "https://api.greyridgesignals.ai/x402/preflight/preview?ref=greyridge"

# against a real endpoint you're about to pay
curl -s "https://api.greyridgesignals.ai/x402/preflight/preview?url=<the-x402-endpoint>&ref=greyridge"
```

The response carries `delivery: { verdict, output_specified, served_without_payment, note }` next to the settle, safety, price-accuracy, and reliability blocks. Read-only. Never pays. Not a settlement guarantee — a pre-payment readiness signal, and the one axis the price-only checkers can't give you.

*Grey Ridge Signals — pre-payment due diligence for agents that spend money on x402.*
