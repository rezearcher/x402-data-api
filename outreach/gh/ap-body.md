Your "slippage guard for AI agents" covers Polymarket/on-chain execution risk; the piece that's usually missing before a Base ERC-20 swap is a **token sellability check** (honeypot / transfer tax / thin-liquidity price impact). We sell exactly one call for it: `GET https://api.greyridgesignals.ai/gate/swap?token=0x…&side=buy&notional_usd=500` → `go|hold|block` + reason, $0.008 over x402 (USDC on Base), no key.

Free, no wallet: `curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=degen&notional_usd=500"` (any real Base address: 3 free/day/IP).

If it fits as a rule input in your guard (or as a listed tool, for the catalog repo case), I'm glad to send a patch. Manifest: https://api.greyridgesignals.ai/.well-known/x402. Close if not relevant.
