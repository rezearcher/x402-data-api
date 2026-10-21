## What

Adds one **Market data** partner service to `src/partners/registry.ts`: a **pre-swap token-safety gate** for Base ERC-20 tokens (`token_safety_gate` → `GET /gate/swap`).

## Why this fills a real gap

The `Market data` category today gives agents **prices** (crypto / fx / commodity). What a ClawRouter-driven trading agent is missing is the check it needs *one step before the swap it's about to sign*: **"is this token safe to buy/sell?"** — honeypot, buy/sell tax, mintable/pausable/blacklist admin controls, a 0–100 risk score, and a go / caution / no-go decision. That's a natural companion to DEX routing and crypto quotes, and it's exactly the kind of outcome your agents can't get from a price feed.

## It's already live on your exact rail

Grey Ridge runs this as a pay-per-call x402 API on Base — **same settlement as your existing partners** (USDC on Base, no account/key), so wiring is minimal:

```
# PAID (x402 challenge on Base):
$ curl -o /dev/null -w "%{http_code}\n" \
    "https://x402-data-api.sigrunner.workers.dev/gate/swap?token=0x4200000000000000000000000000000000000006&side=buy&notional_usd=100"
402          # 402 accepts: network=eip155:8453  asset=USDC(0x833589fC…)  amount=8000 ($0.008)  payTo=0x5765ae06…

# FREE preview (no wallet, verify the exact response shape first):
$ curl -o /dev/null -w "%{http_code}\n" \
    "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x4200000000000000000000000000000000000006&side=buy&notional_usd=100"
200
```

Response shape: `{ decision, verdict, risk_score, flags[], token_meta, … }` — see the free preview above.

## Scope of this PR

This change is **additive data only** — a single entry in the documented `PARTNER_SERVICES` extension point ("New partners are added here — the rest of the system picks them up automatically"). No logic touched; it builds a `blockrun_token_safety_gate` tool via the existing `buildTool`.

The **one step on your side** (the part only you can do) is mapping the `/gate/swap` proxy path to the Grey Ridge upstream (`https://api.greyridgesignals.ai`) on the `blockrun.ai/api` gateway, so the per-call x402 settles to the partner. Happy to adjust the `id`, `pricing`, `params`, or `proxyPath` to whatever fits your gateway's partner conventions — just say the word and I'll push the change.

x402 manifest: https://api.greyridgesignals.ai/.well-known/x402 · contact: contact@greyridgesignals.ai

🤖 Generated with [Claude Code](https://claude.com/claude-code)
