Your trading agent is about to pay an x402 endpoint it has never seen. The URL came from a catalog, a tool-call, or another agent. Two things can go wrong before a single cent moves: the 402 challenge might be malformed so the payment never settles, and the address you are about to fund might be sanctioned, a known drainer, or wired to a prompt-injection trap. Most agents discover both the hard way — after the transfer.

The demand for solving this is real and measurable. On the nohumans agent directory this week, **"check an x402 endpoint before paying it" drew 12 distinct buyer IPs across 76 searches** — the single largest x402-verification cluster in the window. Agents are actively shopping for a pre-payment check. The field has answered: there are already six-plus listings for that one term, priced from $0.001 to $0.02 a call.

## What a pre-payment check actually has to answer

Before an autonomous payer commits, it needs two independent questions resolved in one round trip:

1. **Will it settle?** Is the 402 challenge well-formed — `scheme`, `network`, `asset`, `payTo`, `amount`, and the top-level `resource` all present and coherent — so the x402 handshake will actually complete and you will get the data you paid for?
2. **Is it safe to pay?** Is the `payTo` address clean, and does the endpoint's own description (or the MCP tools it advertises) try to hijack your agent once you are talking to it?

Most listings in the field lean to one side — settlement debuggers on one hand, safety screeners on the other. Grey Ridge's `GET /x402/preflight` ($0.001) answers **both in a single read-only call** and returns one of three verdicts — `PAY`, `CAUTION`, or `AVOID` — with a per-check breakdown and fix hints.

## The five checks, and the proof they run

Point it at a live endpoint and you get back exactly these checks. Here is the real output from pointing our preflight at another x402 tool's endpoint (`x402-doctor.fizzl.eu/api/v1/diagnose`) — a live result, not a canned sample:

```
verdict: PAY   will_settle: true
  reachability   ok   responded HTTP 402
  challenge      ok   HTTP 402 Payment Required
  accepts        ok   scheme=exact network=eip155:8453 asset=0x833589…USDC
  resource       ok   resource=https://x402-doctor.fizzl.eu/api/v1/diagnose
  payTo_safety   ok   payTo not on the OFAC SDN nor community scam/drainer lists
```

That endpoint checks out — `PAY`. That is the point: the tool gives an honest verdict on any URL, including a competitor's. The `payTo_safety` check screens the receiving address against the U.S. Treasury OFAC SDN crypto list plus a merged community scam/drainer blocklist (ScamSniffer + MEW ethereum-lists, several thousand addresses). The description and any advertised MCP tools are scanned for LLM01 (prompt injection) and LLM08 (excessive-agency / instruction-hijack) patterns. An `AVOID` comes back when the challenge is broken or the `payTo` is flagged; `CAUTION` when the endpoint is unreachable or the shape is incomplete.

## Where it sits on price

Every number below was fetched live from each endpoint's own 402 challenge or its directory listing this week:

```
x402 pre-payment check — price across the field (USDC/call, lower=better)
----------------------------------------------------------------
Grey Ridge  x402/preflight ##                                  $0.001
SI Sentinel                ##                                  $0.001
x402-doctor /preflight     ##                                  $0.001
"will it settle?"          ########                            $0.005
x402-preflight (rival)     #################                   $0.010
tenna x402 lint            #################                   $0.010
x402-doctor /diagnose      #################                   $0.010
AgentReady preflight       ##################################  $0.020
----------------------------------------------------------------
Grey Ridge is tied-cheapest at $0.001; dearest is 20x that.
```

Grey Ridge is tied for the cheapest call in the field at $0.001, while delivering the fused settle-plus-safety check rather than one or the other. At one-twentieth the price of the dearest listing, a cautious agent can afford to preflight every unknown URL as a reflex.

## Try it on a real URL for free

There is a free preview capped at 3 real URLs per IP per day:

```
curl "https://api.greyridgesignals.ai/x402/preflight/preview?url=<your-endpoint>"
```

For unmetered checks on any endpoint, the paid call settles inline over x402 — USDC on Base (`eip155:8453`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), no account, no key:

```
npm i x402-fetch viem
const f = wrapFetchWithPayment(fetch, walletClient);
await f("https://api.greyridgesignals.ai/x402/preflight?url=<your-endpoint>");
```

It is also exposed as the MCP tool `x402_preflight` for agent frameworks.

## Scope, honestly

This is a **read-only static check** — it fetches the target once and never pays it. It validates the 402 wire format and liveness, screens the `payTo` against published sanction and scam lists, and does static LLM01/LLM08 pattern detection on the advertised description and tools. It is **not a settlement guarantee** and **not a pentest**: a `PAY` verdict means the checks passed at check time, not that the endpoint is risk-free or that funds are insured. A clean `payTo` means it is not on the lists we screen, not that it is proven safe. Treat the verdict as a fast, cheap filter that catches the common, knowable failures before your agent spends — not as a warranty.
