# Did your x402 payment actually settle? A post-pay, on-chain receipt check your agent can run in one call

Your agent pays an x402 endpoint. The facilitator hands back a `PAYMENT-RESPONSE` header that says *settled*. Your agent believes it, moves on, and charges the cost to the run.

Here is the problem nobody wants to say out loud: **a 402 response is not proof of payment, and a facilitator's "settled" message is a claim to verify.** That is not our framing — it is the conclusion of a working practitioner who sat down and verified x402 settlements against the chain ([johnnyko, dev.to](https://dev.to/johnnyko/how-to-verify-an-x402-payment-actually-settled-on-chain-29oj)). An IETF Internet-Draft makes the same point structurally: the payment-response reference is facilitator-issued rather than a self-contained receipt, so an auditor cannot validate it without contacting the facilitator ([draft-vauban-x402-consolidated](https://www.ietf.org/archive/id/draft-vauban-x402-consolidated-00.html)). An off-chain receipt does not prove anything reached a public ledger.

So if you want ground truth — *did my USDC actually land at the address this endpoint advertised, for at least the amount it advertised* — there is exactly one place to get it: the chain itself.

`GET /x402/receipt-verify` is that check, as one hosted call.

## What it does

You bring two things your agent already has after a payment: the **Base settlement tx hash** and the **resource URL you paid**. The endpoint:

1. Reads the transaction receipt from Base mainnet.
2. Decodes the USDC `Transfer` events out of the receipt logs.
3. Resolves the endpoint's **advertised** `payTo` + `amount` — from the resource's own live 402 challenge (or you pass `&payto=` / `&expect=` to bind it directly without a fetch).
4. Reconciles the two and returns a single verdict:

| verdict | meaning |
|---|---|
| `SETTLED` | USDC reached the advertised `payTo`, for ≥ the advertised amount |
| `UNDERPAID` | reached the right address, but short of what was advertised |
| `WRONG_RECIPIENT` | USDC moved in this tx, but **none** to the advertised `payTo` |
| `NO_TRANSFER` | no USDC `Transfer` to that address at all |
| `REVERTED` | the tx reverted on-chain — nothing moved |
| `NOT_FOUND` | no receipt for this hash (unknown, not yet mined, or wrong chain) |
| `UNVERIFIED` | we could not resolve an advertised `payTo` to reconcile against |

The amount check carries a 1% tolerance (`Math.max(1, round(advertised * 0.01))` atomic units) so a rounding dust difference does not read as underpayment, but a real shortfall does.

## Prove it on a real transaction — free, right now

This is the part the pre-pay trust checkers can't show you, so here is a real Base-mainnet settlement you can reconcile yourself. The free preview allows 3 real checks per IP per day; no key, no wallet, read-only.

A real tx — `0x3e969e2dc30058ef7e621eb06ac8eb4ca3b75be6fc4ce7c6a509f0d47252a0b1` — moved **0.005 USDC** to `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10` in block **48783946**. Watch the verdict flip as you bind it to different expectations:

```bash
TX=0x3e969e2dc30058ef7e621eb06ac8eb4ca3b75be6fc4ce7c6a509f0d47252a0b1
PAY=0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10

# 1. settled to the right address
curl -s "https://api.greyridgesignals.ai/x402/receipt-verify/preview?tx=$TX&payto=$PAY"
# -> verdict: SETTLED   settled: true   (0.005 USDC matched)

# 2. same tx, but you expected 1.00 USDC
curl -s "https://api.greyridgesignals.ai/x402/receipt-verify/preview?tx=$TX&payto=$PAY&expect=1.00"
# -> verdict: UNDERPAID  "received only 0.005 USDC but the endpoint advertises 1"

# 3. same tx, reconciled against a different address
curl -s "https://api.greyridgesignals.ai/x402/receipt-verify/preview?tx=$TX&payto=0x000000000000000000000000000000000000dEaD"
# -> verdict: WRONG_RECIPIENT  "this tx moved USDC but NONE to the advertised payTo"

# 4. a hash that never settled
curl -s "https://api.greyridgesignals.ai/x402/receipt-verify/preview?tx=0x0000...0001&payto=$PAY"
# -> verdict: NOT_FOUND  settled: false
```

Those four outputs are produced by the same deterministic verdict function the paid route runs ([`computeReceiptVerdict`](https://api.greyridgesignals.ai/llms.txt), covered by 46 assertions in the test suite). Nothing is mocked — the chain data is live.

## Where this sits next to what already exists

Being honest about the landscape, because you should trust a tool that is straight with you about its boundaries:

- **The pre-pay trust scorers** — x402station Guard (liveness / error history), x402-trust (seller uptime, compliance, age, A–F), Delivery Score / ttimesai (advertised-vs-listed price) — all answer questions *before* you pay: is this endpoint alive, reputable, priced as listed. Useful. But none of them reconciles a **real settlement that already happened.** They stop at the 402. This starts after it. Pair them; don't substitute.
- **The DIY on-chain recipe.** The [dev.to walkthrough](https://dev.to/johnnyko/how-to-verify-an-x402-payment-actually-settled-on-chain-29oj) is genuinely good, and if you want the deepest possible check you should read it: it recovers the EIP-3009 signature, checks nonce consumption, matches the `Transfer` log, and confirms the validity window. That is more than this endpoint does (see scope below). The trade is that you run and maintain it, you need an RPC, and — the author's own hard-won lesson — you often have to **re-check later** because chain state lags at settlement time. `receipt-verify` is the hosted version of the step that answers the payer's actual question (*did it land, to the right place, for the right amount*), with the advertised-402 binding built in and no RPC to run.
- **Facilitator "settled" receipts** (e.g. the Nevermined model) return a tx hash you still have to trust the facilitator for. This is the independent read.

## Honest scope — what it is and isn't

- It is **read-only**. It does not move funds, re-run a payment, or refund anything. The scope note the endpoint returns, verbatim: *"reconciles a Base-mainnet settlement tx against an x402 endpoint's advertised payTo + amount (on-chain USDC Transfer proof); read-only, confirms what already settled — it does not move funds, re-run a payment, or guarantee the resource was delivered off-chain."*
- `SETTLED` confirms **settlement, not delivery.** It proves the USDC arrived at the advertised address; it cannot prove the endpoint then returned the data you paid for. That is a separate question (and it's the one `/x402/preflight`'s delivery axis screens for *before* you pay).
- It reconciles the **on-chain USDC `Transfer`** against the advertised `payTo` + amount. It does **not** currently verify the EIP-3009 authorization signature, nonce, or validity window — those matter to a facilitator preventing replay, less so to a payer confirming where their money went. If you need those too, run the DIY recipe above alongside.
- It is **point-in-time.** A transaction broadcast seconds ago may read `NOT_FOUND` until it's mined and propagated — recheck it, exactly as the practitioner guide recommends.

## Price

`$0.004` USDC per call over x402 on Base — the same rail your agent already pays on, so it wires in with one line:

```js
import { wrapFetchWithPayment } from "x402-fetch";
const pay = wrapFetchWithPayment(fetch, walletClient);
const r = await pay("https://api.greyridgesignals.ai/x402/receipt-verify?tx=0x…&url=https://…");
```

A single caught `WRONG_RECIPIENT` or `UNDERPAID` — a payment your agent would otherwise have booked as successful — is worth far more than the fraction of a cent the check costs. It's the kind of check that belongs *inside* the loop: run it on every settlement your agent makes, not once as a listing.

---

*Grey Ridge Signals — on-chain and x402 checks priced for agents. `GET /x402/receipt-verify` ($0.004) is the post-pay half of `GET /x402/preflight` ($0.001), which screens an endpoint — safety, price-accuracy, delivery, reliability — before you pay. Catalog: [api.greyridgesignals.ai/for-agents](https://api.greyridgesignals.ai/for-agents).*
