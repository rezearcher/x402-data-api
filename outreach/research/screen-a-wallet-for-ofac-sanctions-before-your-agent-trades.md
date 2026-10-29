# Screen a wallet for OFAC sanctions before your agent trades

An autonomous agent on Base signs its own transactions. That is the point — and it is also the exposure. The moment it sends, swaps, or approves against a counterparty on the U.S. Treasury's sanctions list, the human who owns that key is the one holding a sanctions-violation problem. No agent framework ships this check by default, and over the last window other agents went looking for it: "check if a wallet address is sanctioned or a scammer" was asked by ten distinct callers on a public x402 demand board. So here is the honest walkthrough of what `GET /chain/wallet-screen` does, what it costs, and the two places it is deliberately narrow.

## One keyless call, before you pay anything

The preview is live and open — no key, no account:

```
GET https://api.greyridgesignals.ai/chain/wallet-screen/preview
```

It hands back a real, currently-sanctioned address so you can wire up parsing against the exact shape the paid route returns:

```json
{
  "sanctioned": true,
  "verdict": "blocked",
  "lists": ["OFAC-SDN"],
  "flags": ["ofac-sdn-sanctioned"],
  "source": {
    "name": "OFAC SDN — crypto addresses",
    "authority": "U.S. Department of the Treasury, Office of Foreign Assets Control",
    "snapshot_date": "2026-10-28",
    "entries": 120
  }
}
```

Pass `?address=<0x…>` to screen a real address free, capped at 3 per IP per day. For unmetered screening of any address, the paid route is the same data without the cap.

## What it costs

```
GET https://api.greyridgesignals.ai/chain/wallet-screen?address=<0x…>
→ HTTP 402 Payment Required
```

| field | value |
|-------|-------|
| price | 4000 µUSDC = **$0.004 per call** |
| asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| network | Base — `eip155:8453` |
| scheme | `exact` (EIP-3009 gasless USDC authorization) |

Your x402 client signs the challenge and retries. No gas on your side, no key to rotate, no monthly invoice.

## Where the answer comes from — and why that matters

The verdict is an exact-match lookup against the authoritative source: the OFAC Specially Designated Nationals crypto-address list published by the U.S. Department of the Treasury. 120 addresses in the snapshot dated 2026-10-28, vendored and refreshed, so every answer carries the snapshot date it was decided against. That makes the call auditable — you can reproduce exactly why an address was blocked, and against which day's list. A "sanctioned: true" is never a heuristic score or a guess; it is "this address is on the Treasury list."

## Honest positioning against what else is listed

The same demand board returns three other services for this need. Here is where each sits, truthfully:

| | Grey Ridge `/chain/wallet-screen` | multi-list rivals (OFAC+UN+EU+UK) | single-endpoint OFAC APIs |
|---|---|---|---|
| jurisdiction coverage | **OFAC-SDN only** | OFAC + UN + EU + UK | OFAC |
| payment | keyless x402, $0.004/call | varies / account | varies / account |
| answer is dated + reproducible | yes (snapshot date on every call) | varies | varies |
| sits inside a pre-trade gate | yes — same MCP as honeypot, sell-sim, sizing | no | no |

If your agent operates under EU, UK, or UN sanctions regimes as well, a multi-list screen covers more jurisdictions than we do — that is a real reason to pick one of them, and we will not pretend otherwise. What this route is built for is the U.S.-sanctions case, answered authoritatively and cheaply, inside the same safety gate that already checks whether the *token* is a honeypot. One call screens the counterparty; the next screens the asset. An agent that is already paying per-call for token safety adds counterparty screening without a second vendor or a second account.

## Two things it does not do

**It screens for sanctions, not for "scammer."** The demand phrase says "sanctioned or a scammer." This route answers the sanctions half against the Treasury list. It does not yet carry a drainer/scam-reputation feed, so a `verdict: clear` means "not on the OFAC snapshot" — not "this wallet is trustworthy." Reputation screening is a separate signal.

**"Clear" is not "safe."** Clear means the address is absent from the vendored OFAC SDN snapshot on the stated date. For a compliance-critical decision, confirm against the live SDN list — the response says so in its own disclaimer. We would rather be narrow and honest than imply a guarantee the data cannot back.

## Drop it in

Point any `x402-fetch` client at the 402 challenge above — no package needed:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
const f = wrapFetchWithPayment(fetch, walletClient); // walletClient = your agent's own key
const r = await f("https://api.greyridgesignals.ai/chain/wallet-screen?address=0x…");
```

The same screen is also tool number 31 in the Grey Ridge MCP server (`chain_wallet_screen`), so an MCP-connected agent calls it alongside the honeypot and sell-simulation tools in one place. Full route list and payment docs: `https://api.greyridgesignals.ai/llms.txt`.
