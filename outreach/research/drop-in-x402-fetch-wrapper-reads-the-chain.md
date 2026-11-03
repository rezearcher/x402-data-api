Your x402-paying agent gets a 402, signs, pays, and reads `success: true` off the response. It never reads the chain. So when the USDC actually goes to a different address, goes short, or never moves at all, the agent has no idea — it was *told* it paid, and it believed the teller.

`@grey-ridge/x402-verified-fetch` closes that loop. It is a drop-in wrapper with the **same signature** as `wrapFetchWithPayment` from Coinbase's official `@x402/fetch` client, so it slots into an agent you already shipped. After the payment settles, it decodes the `PAYMENT-RESPONSE` header the server hands back, pulls that transaction's receipt from two independent Base RPCs, decodes the USDC `Transfer` events, and reconciles them against the `payTo` and amount the endpoint advertised in its own 402.

The verdict is on-chain ground truth, not a claim the server made about itself:

```
SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED
```

## The gap, in one table

There is a healthy shelf of x402 wrapper libraries now. We pulled last-month npm download counts (npm's own API, for the 30 days ending 2026-11-02) and read what each one actually does:

| package | downloads / mo | reads the chain after paying? |
|---|---:|---|
| `@x402/fetch` (the base we wrap) | 671,132 | no — it is the payer client |
| `agent-receipt-verify` | 4,685 | no — header/hash linkage only |
| `x402-safe-fetch` | 3,352 | no — pre-pay conformance + cap |
| `settled-x402` | 2,522 | no — pre-pay screen |
| `@grey-ridge/x402-verified-fetch` | new | **yes — dual-RPC Base receipt read** |

Every other wrapper stops at the *pre-payment* 402: a conformance check, a budget cap, a response-prompt-injection screen, a header match. Useful work — but none of them reads the settlement transaction. That is the one thing this package does, and the reason it composes `@x402/fetch` (671k downloads a month) instead of competing with it. You keep your existing payment flow; you add an independent audit of what actually moved.

## Install and use

npm trusted-publishing for the `@grey-ridge` scope is still being set up, so install straight from git — it resolves under the real package name and builds on install:

```bash
npm install github:rezearcher/x402-verified-fetch
```

```ts
import { wrapFetchWithVerifiedPayment } from "@grey-ridge/x402-verified-fetch";
import { x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";

const client = new x402Client().register("eip155:8453", new ExactEvmScheme(signer));

const fetchVerified = wrapFetchWithVerifiedPayment(fetch, client, {
  onMismatch: "throw",                     // abort if the settlement does not verify
  onSettlement: (s) => console.log(s.verdict, s.tx, s.block),
});

const res = await fetchVerified("https://seller.example/x402/data");
// res.headers.get("x-grs-settlement") -> full verdict JSON
```

No new key handling — you bring your own wallet, exactly as before. Zero RPC SDK: it reads the chain over plain JSON-RPC `fetch`, so there is no `viem`/`ethers` requirement and no new runtime weight beyond `@x402/core`, which `@x402/fetch` already pulls in.

## Fail closed, not fail quiet

`readSettlementReceipt` queries two independent Base RPCs and fingerprints each receipt's `(status + USDC transfers)`:

- both reachable **and agree** → `dual-confirmed`
- both reachable **and differ** → `rpc-disagreement` → verdict `UNVERIFIED` (we refuse to trust a single source)
- only one reachable → `single-source`, degrade-open and disclosed in the `confirmation` field

A single RPC returning a stale or forged receipt cannot move the verdict on its own. By default a mismatch is *annotated* (written to the `x-grs-settlement` response header and an `onSettlement` callback) so it never silently breaks a paying agent; set `onMismatch: "throw"` to hard-abort instead.

## Honesty (Claims Law)

This confirms the on-chain settlement went to the right address for the right amount. It does **not** prove the off-chain resource was delivered or that its content is correct — later settlement failure or cache reuse is a separate failure mode. A `SETTLED` verdict is a payment proof, not a delivery guarantee. The pre-payment half of the problem (will it settle, is the payee screened, does the price match what was advertised) is a different check — that is `/x402/preflight`.

## Verified, not asserted

The package ships with 14 Node tests, two of which run end-to-end through the real `@x402/fetch` + `@x402/core` encode/decode path, plus a clean-room git install that builds and resolves under the real scope. The dual-RPC reader is proven against live Base mainnet. The reconcile core is a faithful port of the same logic running behind Grey Ridge's hosted API.

## Hosted companion

For a managed verdict — OFAC and community-scam screening of the counterparty, richer provenance, a persistent audit trail — the same logic runs behind the hosted x402 API. There is a live, free example (no account) here: https://api.greyridgesignals.ai/x402/receipt-verify/preview . This package is the local, dependency-light form of the post-payment half.

Related: [verify a payment settled on-chain](https://api.greyridgesignals.ai/research/verify-x402-payment-settled-onchain-receipt-proof) · [safe_fetch: check before paying, prove after](https://api.greyridgesignals.ai/research/safe-fetch-check-before-paying-prove-after-x402-python-node) · [what x402 trust scores do not check](https://api.greyridgesignals.ai/research/what-x402-trust-scores-dont-check-before-your-agent-pays)
