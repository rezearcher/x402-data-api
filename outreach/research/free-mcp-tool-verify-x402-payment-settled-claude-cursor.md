# A free MCP tool that checks whether an x402 payment really settled — no API key, no wallet

Your agent paid an x402 endpoint and got back a "settled" message. The only party vouching for that message is the one that sent it. If you want to know whether the USDC actually reached the address the endpoint advertised, you have to read the chain.

We added a free, keyless tool to our MCP server that does that read for you: `x402_receipt_verify_preview`. Point any MCP client at one URL and ask it about a transaction hash.

## Connect

The server speaks MCP over HTTP at `https://api.greyridgesignals.ai/mcp`. In Claude Code:

```
claude mcp add --transport http grey-ridge https://api.greyridgesignals.ai/mcp
```

Any other MCP client that supports remote HTTP servers takes the same URL. No key and no signup. The preview tool is on the server's free list, so calling it never triggers a payment request.

## What you pass in

- `tx` — the Base-mainnet settlement transaction hash
- `payto` — the address the payment should have reached
- `expect` (optional) — the advertised price in USDC dollars, for example `0.004`

It reads the transaction receipt, decodes the USDC `Transfer` events, and returns one verdict: `SETTLED`, `UNDERPAID`, `WRONG_RECIPIENT`, `NO_TRANSFER`, `REVERTED` or `NOT_FOUND`.

## Run it yourself on a real transaction

We ran the three most useful cases against a real Base transaction, 0x3e969e2dc30058ef7e621eb06ac8eb4ca3b75be6fc4ce7c6a509f0d47252a0b1 (0.005 USDC, block 48783946, [BaseScan](https://basescan.org/tx/0x3e969e2dc30058ef7e621eb06ac8eb4ca3b75be6fc4ce7c6a509f0d47252a0b1)). All three calls were made through the live MCP endpoint on 2026-10-31:

| Arguments | Verdict |
|---|---|
| `payto` = the address that received the payment | `SETTLED` — matched transfer 5000 atomic = 0.005 USDC |
| same, plus `expect` = `1.00` | `UNDERPAID` — it moved 0.005 against 1 advertised |
| `payto` = `0x…dEaD` | `WRONG_RECIPIENT` — USDC moved, but not to that address |

Paste the same arguments into your client and you should get the same answers.

## What it does not do

- It is **not** proof the resource was delivered. A payment can settle and the endpoint can still return garbage. For the delivery side, see the pre-pay checks in [our before-and-after guide](https://api.greyridgesignals.ai/research/x402-payment-due-diligence-before-and-after-your-agent-pays).
- It does not validate the EIP-3009 signature, nonce or validity window. It reconciles what landed on-chain.
- It reads two independent RPC providers and compares them. If they disagree it fails closed (`UNVERIFIED`). If only one answers, the result says `confirmation: single-source`. When we ran the calls above, the response showed one source, so check that field rather than assuming dual confirmation.
- In the free tool, you supply `payto`. Resolving it automatically from a live endpoint's 402 challenge is the paid `x402_receipt_verify` ($0.004).

## Where it fits

Before paying, `x402_preflight` ($0.001) returns PAY, CAUTION or AVOID. After paying, this tool checks the chain. The full loop is written up in [x402 payment due diligence, before and after](https://api.greyridgesignals.ai/research/x402-payment-due-diligence-before-and-after-your-agent-pays).

If you build agents that spend money, try it on your last ten payments. Every call costs nothing.
