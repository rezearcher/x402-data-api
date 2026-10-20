Tool request / Tenjin list candidate: **pre-trade token safety for Base** (x402, $0.01 USDC)

Use case: when an agent (or the user's prompt) is about to buy, swap, integrate or recommend a Base ERC-20 — "is this token a honeypot / can I sell it / can the owner mint or blacklist?" — web search and CoinMarketCap quotes can't answer that; an on-chain sell simulation can. Today the router has no tool for it, so agents guess from a price page.

Seller: Grey Ridge Signals — x402 on Base, USDC, no API key. Already in the CDP Bazaar.
- `GET https://api.greyridgesignals.ai/chain/token-report?token=<0x… or symbol>` — $0.01. Returns `verdict` SAFE/CAUTION/AVOID, `security` (isHoneypot, sellable via sell-simulation, canMint, canPause, hasBlacklist, upgradeableProxy, ownerRenounced), `liquidity` (Uniswap v3 WETH pool USD).
- `GET /gate/swap?token=…&side=buy&notional_usd=…` — $0.008, GO / HOLD / BLOCK incl. notional-vs-liquidity.
- Free keyless preview so you can verify the shape before listing: `curl 'https://api.greyridgesignals.ai/chain/token-report/preview?token=aero'` (~1s).

Honest limits: Base only; it does not return buy/sell tax percentages (response says "not measured"); uptime/latency numbers will be published only after our probe has ~2 weeks of samples (collecting now).

If a reviewed-list entry needs anything (OpenAPI, example input/output, a test token), tell me and I'll supply it the same day. Contact: contact@greyridgesignals.ai
