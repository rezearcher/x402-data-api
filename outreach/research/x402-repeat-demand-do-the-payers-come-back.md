# Safe to pay ≠ worth paying: the x402 signal that asks "do the payers come back?"

An autonomous agent deciding whether to pay an x402 endpoint can already answer *is this safe?* — liveness, advertised price, OFAC/scam screening, will-it-settle. None of those answer the question that actually protects a budget: **was it worth paying?** The only honest, un-spoofable answer to that lives on-chain — do this endpoint's payers **come back and pay again**, or is every settlement a first-and-last visit?

`GET /x402/repeat-demand` measures exactly that, in one call, at the moment an agent is about to pay.

## What it does

Pass an x402 URL (its live `402` challenge supplies the `payTo`) or a raw `&payto=0x…`. The route scans **incoming USDC settlements to that payTo on Base mainnet**, groups them by the paying wallet, and returns distinct vs repeat payers:

| field | meaning |
|---|---|
| `verdict` | `REPEAT_DEMAND` · `SINGLE_USE` · `NO_SETTLEMENTS` · `UNRESOLVED` |
| `distinct_payers` | unique sender wallets seen paying this endpoint |
| `repeat_payers` | wallets that paid **≥ 2 times** (the actual repeat signal) |
| `repeat_rate` | `repeat_payers / distinct_payers` |
| `gross_usdc`, `first_seen`, `last_seen`, `span_days` | settlement volume + the window it happened in |
| `top_payer` | the heaviest single payer (payments + USDC) |
| `is_own_endpoint` | flagged `true` when the payTo is the caller's own wallet — self-funding disclosed |

A payer counts as "repeat" only at `count ≥ 2`. The verdict is `REPEAT_DEMAND` the moment at least one wallet has returned, `SINGLE_USE` when payers show up once and never come back, `NO_SETTLEMENTS` for an endpoint whose payTo has no inbound USDC yet (unproven — **not** a negative safety verdict), and `UNRESOLVED` when no payTo could be bound.

Representative verdict shape (the preview's sample, not a live endpoint):

```
verdict:          REPEAT_DEMAND
settlements:      41
distinct_payers:  9
repeat_payers:    5     →  repeat_rate 0.556
gross_usdc:       0.182
span:             29.4 days
```

5 of 9 wallets came back. That is the signal — "proven repeat value, the only on-chain evidence the resource was worth paying for."

## Why this is the missing half

The ecosystem has spent a year learning that **payments, not listings, are the demand signal** — and that even payment counts can lie. A widely-cited Base figure is a single wallet credited with **133,528 agent payments in 24 hours** that has *never sent a transaction itself* (its gas is sponsored by others) — raw settlement counts inflate wildly. Distinct-payer counts help; **repeat**-payer counts are the strongest cheap signal that real, returning demand exists. Independent reporting (Chainalysis, via CryptoSlate) notes repeat funding among active wallets is rising while median time-to-first-payment collapsed from 73 days to ~18 minutes.

So who already measures this, and where's the gap?

| tool | what it is | gap `repeat-demand` fills |
|---|---|---|
| **x402-base-pulse** (Substreams) | an on-chain **indexer you deploy** — payer leaderboards, spend-per-payer, revenue-per-server | you have to stand up and host a Base indexer; it's infra, not a drop-in verdict an agent calls mid-decision |
| **x402station** | whole-ecosystem **dashboard** probing ~86k endpoints, merging CDP settlement data, flagging "zombie" endpoints | a human dashboard, not a one-call API returning a per-endpoint repeat-payer verdict at the agent's pay moment |
| **safe/preflight checks** (ours + others) | liveness, price, OFAC, will-it-settle | these say *safe to pay* — none say *worth paying* |

`repeat-demand` is the only piece shaped as a **single pay-time call, per endpoint, that resolves the payTo from the live 402 and reads the chain** — no indexer to host, no dashboard to read. COGS is $0 (Blockscout's public API, public-RPC `eth_getLogs` fallback), so it's priced at **$0.004** per unmetered scan, with a free preview (3 real scans/IP/day) at `/x402/repeat-demand/preview`.

## Honest scope (what it is NOT)

This is a deliberately narrow, read-only on-chain measurement — stated plainly so no agent over-trusts it:

- It **proves repeat payment, not delivery quality.** Payers returning is strong evidence the thing was useful; it is not a guarantee the next response is good. It is never a "safe" verdict.
- For a **dedicated** x402 payTo, inbound USDC == the endpoint's paying agents. A **shared or treasury wallet** that collects for many purposes **overcounts** — disclosed on every response.
- It is a **lower bound.** The scan walks recent pages and reports a `capped` flag when it hits the page limit, so a repeat beyond the scanned window can be missed.
- Like any payer count, it **cannot fully rule out an operator funding their own traffic** (the gas-sponsorship problem above). We flag `is_own_endpoint` when *our* wallet is the payTo; third-party self-funding is a known limit of all on-chain demand metrics, not something any tool can perfectly detect.

## Try it

```bash
# Free (3/IP/day) — measure a real endpoint:
curl "https://api.greyridgesignals.ai/x402/repeat-demand/preview?url=https://some-x402-endpoint.example/data"

# Or bind a payTo directly:
curl "https://api.greyridgesignals.ai/x402/repeat-demand/preview?payto=0xYourEndpointPayTo"

# Paid ($0.004, unmetered) — x402 USDC on Base, settles inline.
```

Pair it with a pre-pay safety screen and you have both halves of the pay decision: *safe to pay* **and** *worth paying*.
