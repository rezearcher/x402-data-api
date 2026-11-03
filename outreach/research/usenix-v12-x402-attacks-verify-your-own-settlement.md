# USENIX and V12 just proved every x402 facilitator they tested is exposed. Here is the one check your agent can still run for itself.

In October 2026 two independent bodies of work landed on the same conclusion from different directions: the trust your AI agent places in an x402 payment facilitator is not safe to assume. If your agent pays for data or an API over x402, the question stopped being academic. This is a short, honest field guide to what was found, which part of it actually lands on the *buyer* (your agent), and the one thing a buyer can verify without trusting anyone's word — including ours.

We build `GET /x402/receipt-verify`, a read-only, buyer-side, on-chain settlement check. We are not a facilitator and we do not fix facilitator bugs. We are describing the check an agent developer can run after paying, so a bad settlement does not pass silently. Every number below is traceable to a public source or to our own source code; where we could not independently confirm a figure, we left it out.

---

## What was actually found

**USENIX Security 2026 — "When HTTP 402 Meets the Blockchain: Risks on Emerging x402 Payments"** ([arXiv 2607.19545](https://arxiv.org/pdf/2607.19545)). The authors present the first security analysis of real-world x402 facilitators, distill **eight unified security rules**, and black-box test **15 major facilitators** — finding **31 previously unknown vulnerabilities**. A secondary write-up counts **49 rule violations** across those facilitators. The paper groups the attacks into four classes: **Free Shopping, Asset Theft, Service Denial, and Gas Abuse.** Because a facilitator verifies and settles payments for many merchants, one facilitator flaw can affect many services at once.

**V12 — 25 x402 SDK vulnerabilities, three critical** (disclosed 22 Oct 2026, reported by [The Hacker News](https://thehackernews.com/2026/10/critical-x402-sdk-flaw-could-let.html)). The three critical items: no default spending limit, a Solana (SVM) payment bypass, and cross-site login signing. The SVM bypass is the sharp one — every published `@x402/svm` release from **2.0.0 through 2.22.0** read a token *approval* as a *transfer*. An approval lets another account spend tokens later but moves nothing itself; it differs from a transfer by one byte. In V12's test the facilitator accepted an approval as valid payment — V12 called it "a complete payment bypass." **Honest caveat:** V12 demonstrated this in a local test, not on a live network. The fix shipped in **2.23.0** (a validation guard requiring the instruction's first byte to equal 12, the `TransferChecked` discriminator).

**The part that should bother you most:** the x402 Foundation never published a security advisory, so `npm audit` and PyPI show **no warning** for the vulnerable releases. A clean `npm audit` does not mean you are on a fixed SDK. The Cloud Security Alliance's companion note makes a related point in one line that is worth keeping: [**a spending cap is not a price check**](https://labs.cloudsecurityalliance.org/research/csa-research-note-x402-agent-payment-sdk-flaws-20261025-csa/) — the $1 default cap V12 recommends limits blast radius; it does not tell you the price was honest or that the money actually moved.

---

## Which of these lands on the buyer

Most of the facilitator and SDK fixes are the seller's and the SDK maintainer's job — upgrade past the vulnerable range, ship the guard. You cannot patch someone else's facilitator. But one USENIX class lands squarely on *you, the paying agent*:

> **Free Shopping** — the off-chain verification path reports success, the service is released, and the on-chain settlement is absent, wrong, or never finalizes.

That is a buyer problem because your agent is the one that paid (or thinks it did) and walked away. The defense is not "trust a better facilitator." The defense is to independently confirm, *on-chain*, that the exact transaction you were handed actually moved the advertised amount of USDC to the endpoint's advertised payTo address — and to not take any single node's word for it.

That is the entire job of `GET /x402/receipt-verify`. You bring your Base settlement transaction hash (`?tx=`) and the resource URL you paid (`?url=`, or bind directly with `&payto=` / `&expect=`). It reads the transaction receipt, decodes the USDC `Transfer` events, and reconciles them against the endpoint's advertised payTo and amount. Verdict (from `src/index.ts:283`):

```
SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED
```

`NO_TRANSFER` is the Free-Shopping tell: a receipt exists, nothing moved. `WRONG_RECIPIENT` catches payment to the wrong address. `UNDERPAID` catches a short settle. None of these require you to trust the facilitator that just told you everything was fine.

---

## Why one RPC is not enough — and the check we just hardened

Here is the subtle failure, and the reason we shipped a change this week. A naive on-chain check reads the receipt from *one* RPC provider and believes it. But a single node can lag, serve a stale view across a reorg boundary, or simply be wrong — and a "verify" step that trusts one source is the same single-point-of-trust weakness the research keeps circling. A practitioner write-up on manually verifying x402 settlement documented exactly this: a first read failed, a recheck ten minutes later passed, because of chain-state lag.

So `receipt-verify` now **cross-confirms across two independent Base RPC providers and fails closed if they disagree.** The logic, straight from our source:

| Both providers reachable and **agree** on the settlement fingerprint | `confirmation: "dual-confirmed"` — trust it |
| Providers **disagree** | `confirmation: "rpc-disagreement"` → verdict **UNVERIFIED** — we fail **closed**, we do not guess (`src/index.ts:10509`) |
| Only one provider reachable | `confirmation: "single-source"` — degrade-open, **disclosed** in the response |
| Both momentarily down | rotation fallback, still single-source and disclosed |

The "fingerprint" that the two providers must agree on is `status + the sorted set of USDC transfers` (`receiptSettlementFingerprint`, `src/index.ts:10384`) — order-independent, so two honest nodes that return logs in a different order still match. A disagreement is a real disagreement, not noise. Failing closed means a lying or lagging node cannot talk you into releasing a `SETTLED` verdict. The response always tells you which mode you got (`confirmation` + `rpc_sources`), so "we could only reach one node" never masquerades as "two nodes agreed."

---

## What this does NOT do (scope honesty)

- It confirms **on-chain settlement, not off-chain delivery.** `SETTLED` means the money moved correctly; it does not promise the seller returned usable data. (That is a different check — answer-correctness audits like Teppi's "a 2xx is not a delivery" cover that ground; we are complementary, not a substitute.)
- It does **not** validate the EIP-3009 signature, nonce, or validity window. It reconciles the *result* on chain, not the authorization object.
- It is **read-only.** It never moves funds, never re-runs a payment, never signs anything.
- It is **point-in-time.** Deep reorgs after your check are not re-watched; re-run if you need more finality.
- `UNVERIFIED` is an honest "we could not confirm," not an accusation. It never silently becomes `SETTLED`.
- We are **not** auditing facilitators and we make no claim about any specific facilitator's safety. USENIX and V12 did that work; we cite it. Our job is the buyer-side confirmation after the fact.

---

## Where this sits next to the other x402 trust tools

Honest coverage map. These are different jobs, and most of them are worth running together:

| Tool | What it checks | On a real settlement tx? | Cross-confirms RPCs? |
|---|---|---|---|
| x402station Guard | endpoint liveness / reachability | no | n/a |
| x402-trust (A–F) | reputation / reachability score — states it does not check price or delivery | no | n/a |
| Delivery Score / ttimesai | advertised price vs listed price (pre-pay) | no | n/a |
| Teppi "2xx is not a delivery" | answer correctness, post-hoc audit of paid calls | no (grades the response, not the chain) | n/a |
| **Grey Ridge `/x402/receipt-verify`** | **your exact tx reconciled vs advertised payTo + amount, on-chain** | **yes** | **yes — dual-RPC, fails closed** |

To our knowledge no other x402 trust tool reconciles a *real settlement transaction* against the advertised payment terms, and none cross-confirms that read across two independent RPCs and fails closed on disagreement. That is the gap, and it is the one Free Shopping actually walks through. (We are not disparaging the others — liveness, reputation, price, and correctness are all real and useful checks. They just do not answer "did my money move correctly on chain.")

---

## Run it free, on a real transaction

The preview path is keyless (3 real on-chain checks per IP per day). Bind the advertised terms directly so you can reproduce every verdict on a real Base-mainnet tx:

```bash
# SETTLED when the tx moved the expected USDC to the expected payTo
curl "https://api.greyridgesignals.ai/x402/receipt-verify/preview?tx=0x<your-tx>&payto=0x<expected-payTo>"

# UNDERPAID when you add an amount that is higher than what settled
curl "...&payto=0x<payTo>&expect=0.004"

# WRONG_RECIPIENT when the payTo does not match the on-chain recipient
curl "...&payto=0x000000000000000000000000000000000000dEaD"
```

The paid route is `GET /x402/receipt-verify` at **0.004 USDC** per call (`src/index.ts:283`). Its pre-pay twin is `GET /x402/preflight` (0.001 USDC) — *will it settle and is it safe to pay* before you send a cent. Together they are the before-and-after of x402 payment due diligence: preflight stops a bad payment, receipt-verify proves a good one. If you run an MCP server or an x402 endpoint yourself, the free scan at [api.greyridgesignals.ai](https://api.greyridgesignals.ai) grades it and gives you an embeddable badge.

---

*Grey Ridge Signals — buyer-side x402 payment due diligence. Read-only, honest verdicts, no guarantees. Sources: [USENIX Security 2026 / arXiv 2607.19545](https://arxiv.org/pdf/2607.19545), [The Hacker News on V12](https://thehackernews.com/2026/10/critical-x402-sdk-flaw-could-let.html), [Cloud Security Alliance research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-x402-agent-payment-sdk-flaws-20261025-csa/).*
