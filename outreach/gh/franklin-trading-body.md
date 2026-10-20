Franklin Trading puts "risk limits in code" — one limit a live-trade path usually lacks is a **token-level sellability check** (honeypot / tax / thin-liquidity price impact) before a fill on a Base ERC-20.

`GET https://api.greyridgesignals.ai/gate/swap?token=0x…&side=buy&notional_usd=500` returns ONE decision `go|hold|block` plus a reason, sized to the trade (notional vs Uniswap v3 liquidity impact). $0.008/call over x402 (USDC on Base) — fits Franklin's x402 billing path, no key/account.

Free, no wallet, to see the shape first:
`curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=degen&notional_usd=500"` (any real Base 0x address: 3 free checks/day/IP).

The same gate is already wired in Haven-AI (`haven_check_token_safety`) and offered to Franklin core as a `BaseTokenGate` PR (#214). Happy to send a patch calling it from the live-trade risk-limit step if you point me at the hook. Close if not relevant.
