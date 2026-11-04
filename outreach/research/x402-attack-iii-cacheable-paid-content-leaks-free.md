# Attack III: when paid x402 content is publicly cacheable, the next client gets it free

Every x402 safety tool shipping today checks the **payment**: is the 402 challenge well-formed, is the payer screened, did the settlement land on-chain. None of them check the layer where paid data actually leaks — the **HTTP cache in front of your API**. That gap has a name now.

In May 2026 a group of researchers published *"Five Attacks on x402 Agentic Payment Protocol"* ([arXiv:2605.11781](https://arxiv.org/abs/2605.11781)) and argued x402 has to be treated as a cross-layer security protocol, not an HTTP wrapper around a payment. **Attack III** is the one nobody is tooling for. From the paper's own evaluation:

> *"Once paid content is publicly cacheable, later clients can retrieve it without paying."*

The mechanism (the paper's D2 case): a client pays, settlement succeeds, your origin returns the 200 — and an intermediary (CDN, shared proxy, "payment-aware" proxy, even a browser cache) stores that paid body *as if it were ordinary public content*. The next agent that hits the same URL is served the cached copy. No 402. No payment. Your paid route just became a free one, and your logs show a single sale.

## Why pre-pay screening and on-chain receipt checks both miss it

This is not a payment-layer bug, so payment-layer tools can't see it:

| Tool class | What it inspects | Sees Attack III? |
|---|---|---|
| Pre-pay screeners (Frisk, AgentTrust, our `/x402/preflight` safety checks) | the 402 challenge, payTo, injection in descriptions | **No** — the leak happens on the *paid* 200, after the screen |
| On-chain receipt verifiers (our `/x402/receipt-verify`, settled-x402, agent-receipt-verify) | the settlement tx on Base | **No** — the payment is real; the body is just also cached |
| x402 payment-identifier idempotency cache | app-level retry key in Redis | **No** — that's a deliberate keyed cache, not the shared HTTP cache in the path |

Frisk's own docs concede the settlement/web layer is "outside what a pre-payment screening call can address." They're right. Attack III sits exactly there. The fix is a seller-side HTTP posture, and a buyer-side screen for whether the seller actually holds it.

## The seller half: make the paid body non-cacheable — by signal, not by a route list

The naive fix is to hardcode `Cache-Control: no-store` on a list of paid routes. That fails silently the moment you add a route and forget. The ground-truth signal is already on the wire: a response that was paid for carries the facilitator's `PAYMENT-RESPONSE` settlement header. So the rule keys on that, not on a maintained list:

```
if (response has PAYMENT-RESPONSE header):   # this body was paid for
    Cache-Control: no-store                  # no shared/proxy/browser cache may store it
    Vary: X-PAYMENT                           # any intermediary keys on the payment header
```

Free `/preview`, `/metrics` and catalog routes never carry `PAYMENT-RESPONSE`, so they stay cacheable and fast — the mitigation is scoped to exactly the bodies Attack III targets, with no hardcoded list to drift. This is live on every paid route of the Grey Ridge rail. Verify it in two curls:

```
$ curl -sS -D - -o /dev/null https://api.greyridgesignals.ai/crypto/prices
HTTP/2 402
cache-control: no-store          # paid route: no shared cache can replay it

$ curl -sS -D - -o /dev/null https://api.greyridgesignals.ai/crypto/prices/preview
HTTP/2 200                        # free preview: left cacheable on purpose
```

## The buyer half: screen any x402 URL for the posture before you pay

If you're the agent paying, you want to know the *seller's* posture before you depend on them. `GET /x402/preflight?url=<endpoint>` now returns an Attack-III `cache_posture` verdict as one of its eight read-only checks (it never pays):

| `cache_posture` verdict | Meaning | Preflight effect |
|---|---|---|
| `NO_STORE` | paid route marked `no-store`/`private` — correct posture | clean |
| `CACHEABLE` | 402 advertises `public`/`max-age` — if the paid 200 inherits it, it can leak | note |
| `OBSERVED_CACHED` | a shared cache is **actively** storing this route (age/x-cache hit) | **trips CAUTION** |
| `UNKNOWN` | no explicit directive observed pre-payment | note (proof is a `no-store` on the paid 200) |

See it on the live endpoint (free preview, no payment):

```
$ curl -sS https://api.greyridgesignals.ai/x402/preflight/preview | jq .cache_posture.verdict
"NO_STORE"
```

That's the complete Attack-III loop: as a seller we hold `no-store` on every paid body by signal; as a screen we tell a paying agent whether the seller they're about to trust does the same.

## Where this sits

`@x402/fetch`, the reference payment client, pulled **240,964 downloads last week** ([npm, 2026-10-27→11-02](https://api.npmjs.org/downloads/point/last-week/@x402/fetch)) — roughly a million agents a month paying for x402 content. Each one is a client whose paid bytes can be replayed for free if the origin or any proxy in the path caches them. The payment-layer tools in that ecosystem are good and you should run them. Attack III is simply a different layer, and until the Five-Attacks paper named it, no x402 tool checked it at all.

**Scope, honestly.** The seller fix forces `no-store` on paid responses; it does not audit a third party's CDN config for you. The preflight check is a read-only, pre-payment observation of headers — it flags a cacheable or actively-cached posture, it is not a penetration test and not a settlement guarantee, and a `NO_STORE` result is a correct posture, not a certificate that no cache anywhere will ever misbehave. `/x402/preflight` is $0.001/call; the `/preview` path is free. Everything above is verifiable with the two curls shown — no claim here that you can't reproduce in your own terminal.

*Grey Ridge Signals — x402 payment verification for autonomous agents. Read-only safety and on-chain settlement proof, priced for machines.*
