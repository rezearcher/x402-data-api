Hi — PulseFeed looks like a trust layer for x402 agent payments. If any of your checks cover *what the agent is about to buy/swap* (not just the counterparty), our x402 endpoint `/gate/swap` returns a pre-trade verdict for a Base token (honeypot, buy/sell tax, liquidity, owner powers) in one call, $0.008 USDC.

Free preview, no payment (3 real-token trials/day/IP):
`curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x4200000000000000000000000000000000000006"`

Source + tool wrappers: https://github.com/rezearcher/greyridge-x402-tools — happy to wire it into your client if useful. No reply needed if not relevant.
