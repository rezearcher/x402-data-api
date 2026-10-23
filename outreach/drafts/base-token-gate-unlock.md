Most "is this token safe" tools stop at a wall of flags and leave you to interpret them. Before a swap on Base, you don't want a checklist — you want one answer: go, hold, or block, sized to the trade you're about to make.

The Base Token Gate does exactly that. Paste a token address and it simulates a sell, scans owner controls (mint, pause, blacklist, upgradeable proxy, renounced ownership), and weighs your intended trade size against the Uniswap v3 WETH-pool liquidity. You get a single decision and the reason behind it.

Three checks a day are free, no signup. When you want it tied to a real position — your actual trade size, any Base token, no daily cap — you can pay as you go without an account: 0.01 USDC straight from your own wallet, in the app. Your wallet signs the transfer, the gate confirms it on-chain, and the full sized check comes back. No card, no subscription, no key to manage. For automated trading agents, the same gate runs pay-per-call over x402 at 0.008 USDC a call.

It's a honeypot and liquidity check built for the moment before you click swap, priced so checking is never the expensive part of the trade.

Run it: https://x402-data-api.sigrunner.workers.dev/miniapp

Heuristic signal, not financial advice.
