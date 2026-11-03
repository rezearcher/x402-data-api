# What x402 trust scores don't check before your agent pays

An agent is about to pay an x402 endpoint it has never seen. The money leaves in one HTTP round-trip, with no chargeback and no human in the loop. The market's own diagnosis of what's still missing is blunt: the gap isn't the payment rail — it's that **agents lack a way to verify delivery, and that the price is honest, *after* they commit.** Reputation is not that check.

The best public x402 reputation scorer today — [x402-trust](https://x402scan.com) (Jonas Fuchß; scoring service at `x402.fuchss.app`, also listed on x402scan.com) — continuously probes every listed endpoint and grades it A–F from real signals: **30-day uptime, 402-envelope spec compliance, latency, observed age, and recently-changed payTo addresses.** That is genuinely useful, and we recommend it. It tells you the seller's *track record*.

It does not tell you whether **this** call — the one your agent is about to settle, right now, at this URL — charges what it advertised, is free of prompt-injection in the text your model will read, and pays out to an address that isn't sanctioned or a known drainer. A history grade and a per-call pre-payment check are different jobs. You want both.

## The per-call check: one read-only call, PAY / CAUTION / AVOID

`GET /x402/preflight?url=<endpoint>` ($0.001) fetches the target **once and never pays it**, then runs seven checks and returns a single verdict. Here is the live free preview (keyless — run it yourself):

```
curl -s https://api.greyridgesignals.ai/x402/preflight/preview
```

```json
{
  "verdict": "PAY",
  "will_settle": true,
  "checks": [
    {"name":"reachability",  "ok":true, "detail":"responded HTTP 402"},
    {"name":"challenge",     "ok":true, "detail":"HTTP 402 Payment Required"},
    {"name":"accepts",       "ok":true, "detail":"scheme=exact network=eip155:8453 asset=…USDC payTo=0x… amount=4000"},
    {"name":"resource",      "ok":true, "detail":"resource=https://seller.example/data"},
    {"name":"payTo_safety",  "ok":true, "detail":"payTo not on the OFAC SDN nor community scam/drainer lists"},
    {"name":"reliability",   "ok":true, "detail":"3/3 probes payable; latency median 210ms"},
    {"name":"price_accuracy","ok":true, "detail":"charged 0.004 USDC == advertised (source: self-manifest)"}
  ],
  "price_accuracy": {"verdict":"MATCH","charged_atomic":4000,"advertised_atomic":4000,"ratio":1,"decimals":6},
  "reliability": {"samples":3,"settle_consistency":"3/3","stable":true,"latency_ms":{"median":210}},
  "scope_note": "static 402 wire-format + liveness + LLM01/LLM08 description scan + payTo OFAC/scam flag + advertised-vs-charged price-accuracy check; read-only, never pays; not a settlement guarantee."
}
```

Every field above is served live by the endpoint today. The paid call against a real target returns Base-mainnet USDC settlement details — `network eip155:8453`, `asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (USDC), `payTo 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10`, `amount 1000` atomic — for $0.001.

## The verdict is three lines of logic, not a vibe

The whole point of a pre-payment check is that it is deterministic and you can see why. The verdict assembles like this:

| Verdict | Condition (exactly what triggers it) |
|---------|--------------------------------------|
| **AVOID** | the challenge won't settle, **or** a critical/high LLM01/LLM08 injection finding in the resource/tool text, **or** the payTo is on the OFAC SDN or a community scam/drainer list |
| **CAUTION** | any soft issue — e.g. the live charge **overcharges** vs the advertised price, the endpoint **flaps** across the reliability burst, or a medium finding |
| **PAY** | none of the above: settles, clean text, clean payTo, priced as advertised |

Reputation scores collapse all of that into one A–F number for the *seller*. The pre-payment check keeps it per-*call* and tells you which specific thing is wrong and how to fix it.

### The axis reputation graders don't cover: advertised-vs-charged price

This is the check the trust-score products don't run. The endpoint quoted $0.001 in its catalog — does the live `accepts[].amount` actually match? Pass `&advertised=<usdc>`, or omit it and the check self-compares against the endpoint's own `/.well-known/x402` manifest:

- **MATCH** — within tolerance (`max(1, round(advertised × 0.01))` atomic — 1% or one atomic unit, whichever is larger; on a 1000-atomic price that's 10 atomic).
- **OVERCHARGE** — the wire charges *more* than advertised. This downgrades PAY→**CAUTION**, never AVOID: overcharging isn't illegal, it's just not what you were quoted, and you should know before you pay.
- **UNDERCHARGE** — charges less than advertised (informational).
- **UNKNOWN** — no advertised price to compare against; a real answer, not a guess.

### Reliability is a burst, honestly labelled

`&samples=N` (1–5) re-probes the 402 challenge N times and returns `settle_consistency`, `settle_rate`, and a latency distribution. An endpoint that answers 402 on probe 1 and times out on probe 3 is `stable:false` and gets downgraded PAY→CAUTION. We label this exactly for what it is in the response: *"point-in-time burst sampled now (not historical uptime); a stable burst is not a durability guarantee."* For 30-day uptime history, use a reputation scorer — that's its job, not ours. Pair them.

## What this is and isn't

- **Read-only.** It fetches the 402 challenge once and never submits a payment. It cannot move your funds.
- **Not a settlement guarantee.** A PAY verdict means the wire format is valid, the text is clean, the payTo is clean and the price matches *right now* — not that the facilitator will settle or that the data will be good. The `scope_note` above ships in every response.
- **"Clear" is not "safe."** `payTo_safety` screens against the OFAC SDN list and community scam/drainer lists (ScamSniffer + MEW). An address absent from those lists is *not on those lists* — not a guarantee of honesty.
- **Self-manifest can't catch a consistent lie.** If an endpoint advertises an inflated price in its own `/.well-known/x402` and charges that same inflated amount, the self-check reports MATCH. Pass your own catalog's `&advertised=` to catch that.

## The economics

At $0.001 a check (1000 atomic / 10⁶ USDC), pre-flighting unknown endpoints is a rounding error against the thing it prevents:

| Volume | Cost |
|--------|------|
| 50 pre-checks/day | $1.50/mo |
| 500 pre-checks/day | $15.00/mo |
| 5,000 pre-checks/day | $150.00/mo |

One avoided $0.05 bad or overcharged payment pays for 50 pre-checks; one avoided $0.25 payment pays for 250. For an autonomous agent spending real USDC on endpoints it didn't write, a per-call due-diligence check that costs a tenth of a cent is the cheapest insurance in the stack.

## Use it

```
# free, keyless, reproducible
curl -s https://api.greyridgesignals.ai/x402/preflight/preview

# paid: pre-check a real endpoint before your agent settles ($0.001, Base USDC, x402)
GET https://api.greyridgesignals.ai/x402/preflight?url=<endpoint>&advertised=<usdc>&samples=3
```

Also exposed as the MCP tool `x402_preflight`. Reputation scores tell you a seller's history; run this on the call you're actually about to pay. Verify before you pay.

---
*Grey Ridge Signals — pay-per-call x402 data & safety for Base agents. No account, no key; agents pay inline in USDC from $0.001/call. This is a read-only discoverability/verification check, not a pentest, settlement guarantee, or financial advice.*
