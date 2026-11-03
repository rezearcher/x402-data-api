A well-formed 402 challenge tells you an endpoint can answer once. It does not tell you the endpoint answers the same way every time. An agent that pays an unknown x402 URL has a second failure mode beyond a malformed challenge: the endpoint flaps. One request returns a clean challenge, the next times out or returns something else, and your payment lands on the wrong side of that coin flip.

`GET /x402/preflight` ($0.001) now takes an optional `&samples=N` (1 to 5). It samples the endpoint's 402 challenge N times and reports how consistent it was.

## What the burst returns

Here is a real result from pointing it at a live third-party endpoint (`x402-doctor.fizzl.eu/api/v1/diagnose`) with `samples=3`, run today:

```
verdict: PAY   will_settle: true
  reachability   ok   responded HTTP 402
  challenge      ok   HTTP 402 Payment Required
  accepts        ok   scheme=exact network=eip155:8453 asset=0x833589...USDC
  resource       ok   resource=https://x402-doctor.fizzl.eu/api/v1/diagnose
  payTo_safety   ok   payTo not on the OFAC SDN nor community scam/drainer lists
  reliability    ok   3/3 probes payable; latency median 54ms (max 800ms)

reliability: settle_consistency 3/3, settle_rate 1, reachable_rate 1, stable true
latency_ms:  min 50, median 54, max 800
```

The three probes came back at 800ms, 54ms, and 50ms. The slow first one is typical of a cold connection, and a single-probe check would have reported whichever of those it happened to catch. The burst shows the spread, so your agent can set its own timeout instead of guessing from one reading.

If the probes disagree (some payable, some not), the verdict is downgraded from `PAY` to `CAUTION`, and `stable` comes back `false`. That is the case a single probe cannot see.

## Where it sits against the other checkers

The x402 checkers we looked at (x402-doctor and settled.tools) probe an endpoint once. A single probe answers "does it settle right now". The burst answers "does it settle consistently", and it sits in the same call as the `payTo` OFAC and scam-list screen and the LLM01/LLM08 description scan. Price is $0.001 per call.

There is a gap the other way too. Continuous monitors that keep history and send alerts do something we do not: they watch an endpoint over days. Preflight is a point-in-time check made at the moment your agent is about to pay. If you need a trend line or an alert when an endpoint goes down at 3am, use a monitor. If you need a cheap gate in the payment path, use this.

## Try it free

The preview is capped at 3 real URLs per IP per day:

```
curl "https://api.greyridgesignals.ai/x402/preflight/preview?url=<your-endpoint>&samples=3"
```

For unmetered checks the paid call settles inline over x402, USDC on Base (`eip155:8453`), no account and no key:

```
const f = wrapFetchWithPayment(fetch, walletClient);
await f("https://api.greyridgesignals.ai/x402/preflight?url=<your-endpoint>&samples=3");
```

It is also available as the MCP tool `x402_preflight`.

## Scope, honestly

This is a read-only point-in-time check. It fetches the target a few times in quick succession and never pays it. A stable burst is not historical uptime and not a durability guarantee. A `PAY` verdict means the checks passed at check time. It is not a settlement guarantee, not insurance, and not a pentest. A clean `payTo` means the address is not on the lists we screen, not that it is proven safe. The LLM01/LLM08 scan is static pattern detection on the advertised description and tools.
