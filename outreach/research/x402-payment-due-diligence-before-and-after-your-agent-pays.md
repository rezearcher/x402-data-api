# x402 due diligence: the checks before *and* after your agent pays

An autonomous agent that pays x402 endpoints is making unsupervised, irreversible USDC transfers on Base. Most "trust" tooling in this space checks exactly one slice of that risk. This is the full map — what can go wrong between the moment your agent decides to pay and the moment the money has settled — and which check covers which slice, with the honest gaps named.

## The problem is now measured, not hypothetical

An independent audit published 28 October 2026 — [*"A 2xx is not a delivery"*](https://dev.to/teppixyz/a-2xx-is-not-a-delivery-6l9) by Teppi — ran **3,618 paid x402 calls across 422 endpoints on 355 hosts** between 31 August and 28 October 2026 and checked the answers against ground truth. The findings:

- **94.9%** of paid calls returned `2xx` (3,434 of 3,618).
- Of the checkable answers, **69 were wrong — and every one of the 69 was billed.**
- **144 paid calls delivered nothing usable** (the 69 wrong answers, 64 errors or empty results, and 11 unusable `2xx` bodies).
- Wrong answers clustered in judgment work: **research 10.1%** (16/159), inference 5.0%, extraction 5.0%, search 4.3% — versus **0.2%** for market-data/onchain/compute (2/1,133).

The author's own line says it best: *"A `200 OK` means the seller replied. It does not mean the reply was right."* And the caveat that matters for every agent builder: *"A spending limit bounds the loss. It does not stop an agent from paying, again and again, for an answer that is wrong."* (The author is explicit that no model grades answers — all checks are deterministic scripts, and 610 of 739 unchecked calls went to endpoints they had no task for, so the true wrong-rate could sit either side of 2.6%. We cite it as directional evidence, not gospel.)

That study measures **answer correctness** after the fact. It is the single best public evidence that "the HTTP call succeeded" is not the same as "you got what you paid for." But answer-correctness is only one of the risks on the wire. Here is the rest of the map.

## The five things that can go wrong on one paid call

1. **It won't settle.** The 402 challenge is malformed or the `accepts[]` can't actually be satisfied — your agent signs, nothing settles, and the call fails after the attempt.
2. **The payTo is hostile.** You're about to send USDC to an OFAC-sanctioned address or a known scam/drainer wallet — a compliance and loss event independent of whether the data is good.
3. **You're being overcharged.** The live `accepts[].amount` is higher than the price your catalog or the endpoint's own manifest advertised. Silent, per call, forever.
4. **The resource is a prompt-injection vector.** The body you're paying to ingest (or the MCP tool description you're wiring in) carries an LLM01/LLM08 payload aimed at your agent, not your user.
5. **The answer is wrong, or the paywall leaks.** Either the seller serves the paid resource to unpaid requests (a leaking paywall — you're paying for something free), or it bills you for a body that's empty/incorrect (the Teppi finding).

A spending cap addresses none of these. It bounds the blast radius; it doesn't stop the loss.

## Who checks what — the honest coverage map

| Tool | What it checks | When | Capital to run |
|---|---|---|---|
| **Teppi — "2xx is not a delivery"** | Answer correctness vs ground truth, by observed task history | After, across sampled endpoints | its own paid calls |
| **x402-trust** (x402.fuchss.app) | Seller reputation A–F: uptime, latency, age, payTo-change history | Reputation, not per-call | none |
| **Delivery-Score / ttimesai** | Advertised price vs listing | Before | none (states it *"cannot tell you whether the seller actually delivers after payment"*) |
| **Lumière PayCheck** | Real delivery proof | After, via test payments | spends real USDC |
| **PolicyLayer / x402station spec** | Policy guidance: amount-match the 402 header, block duplicate payments, allowlist domains | Before (advisory) | none |
| **Grey Ridge `/x402/preflight`** | Will-it-settle + payTo OFAC/scam screen + advertised-vs-charged price + LLM01/LLM08 scan + leaking-paywall/output-spec, on **your exact target** → `PAY\|CAUTION\|AVOID` | Before | **none — read-only, never pays** |
| **Grey Ridge `/x402/receipt-verify`** | Reconciles **your exact settlement tx** against the endpoint's advertised payTo + amount via on-chain USDC Transfer logs → `SETTLED\|UNDERPAID\|WRONG_RECIPIENT\|…` | After | none (reads a tx you already made) |

The pattern: most tools grade the *seller's history* or the *listing*. Two of them (Lumière, Teppi) touch real delivery but either spend capital or report on endpoints *other* agents sampled. The gap we fill is the **per-call structural check on the specific URL and tx in front of your agent, on both sides of the payment, with zero capital on the pre-pay side.**

## The loop: before and after, on your specific call

**Before you pay — `/x402/preflight`** ($0.001/call, read-only, *never* pays the target):

```
GET https://api.greyridgesignals.ai/x402/preflight?url=<the endpoint your agent is about to pay>
```

It fetches the target once and returns `PAY | CAUTION | AVOID` plus the five sub-checks:
1. 402 challenge + `accepts[]` validity — *will it settle*
2. payTo screened against the OFAC SDN crypto list **and** community scam/drainer intel — *safe to pay*
3. price accuracy — pass `&advertised=<usdc>` (or it self-checks the endpoint's `/.well-known/x402`): `MATCH | OVERCHARGE | UNDERCHARGE`
4. optional `&samples=N` (1–5) reliability burst
5. delivery readiness — flags a **leaking paywall** (paid resource served to an unpaid request while the manifest advertises a price) and whether the output shape is specified

Try it free on your own target, 3/IP/day: `GET /x402/preflight/preview?url=<endpoint>`.

**After you pay — `/x402/receipt-verify`** ($0.004/call, reads a tx you already made):

```
GET https://api.greyridgesignals.ai/x402/receipt-verify?tx=<0x base settlement hash>&url=<resource you paid>
```

It reads the transaction receipt, decodes its USDC `Transfer` events, and reconciles them against the endpoint's advertised payTo + amount (from its live 402, or bind directly with `&payto=` / `&expect=`). Verdict: `SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED`. This is the one check that uses the blockchain itself as the source of truth — no facilitator receipt to trust, no seller claim to take on faith.

## What this does NOT do — scope, stated plainly

Honesty is the product here, so the limits are on the label:

- **It does not grade whether the answer is correct.** That is precisely the Teppi gap — their deterministic scripts check answers against ground truth. Preflight and receipt-verify check the *payment*: will it settle, to whom, for how much, is the resource a leak or an injection vector, did the money land where it should. **Use them together** — we catch the structural payment fraud; a correctness check like Teppi's catches the wrong-answer tail. Neither replaces the other.
- **`clear` is not `safe`.** A payTo not on the OFAC or scam lists means it isn't on *those lists today* — not that it is trustworthy.
- **Preflight is point-in-time and never pays**, so it can't catch a seller that returns a well-formed 402 but then lies identically on every call; and a reliability burst is a few live samples, not historical uptime.
- **`SETTLED` confirms settlement, not delivery.** The money reached the right address for the right amount. Whether the bytes you got back were correct is a separate question (see the first bullet).
- **Read-only throughout.** No part of this signs a payment or moves your funds.

## Reproduce it

Everything above is live and checkable without paying us a cent:

```bash
# pre-pay structural check on any x402 endpoint (free, 3/IP/day)
curl "https://api.greyridgesignals.ai/x402/preflight/preview?url=https://api.greyridgesignals.ai/crypto/prices"

# post-pay settlement proof against a real Base tx, binding payTo + expected amount
curl "https://api.greyridgesignals.ai/x402/receipt-verify/preview?tx=0x...&payto=0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10&expect=0.004"
```

Both endpoints return the full JSON — verdict, every sub-check, and the evidence behind it — so you can wire the `AVOID`/`WRONG_RECIPIENT` branch straight into your agent's payment path.

---

*Grey Ridge Signals — x402 payment due-diligence on Base/USDC. Pre-pay [`/x402/preflight`](https://api.greyridgesignals.ai/x402/preflight), post-pay [`/x402/receipt-verify`](https://api.greyridgesignals.ai/x402/receipt-verify). Full route catalog and machine-readable call contracts at [/for-agents](https://api.greyridgesignals.ai/for-agents). Read-only, never pays, not a settlement or correctness guarantee — sold as exactly what it does.*
