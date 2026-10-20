Your README's "unlimited approval blocked" and destination-allowlist rules cover *what* is being signed; they can't tell whether the **token** being swapped into is a honeypot or has a drained pool. A policy rule like `token_reputation` could call a pre-trade gate before the request becomes signable.

Free, no-wallet sample (live Base data, AERO buy $50):
`curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x940181a94A35A4569E4529A3CDfB74e38FD98631&side=buy&notional_usd=50"`
-> `{"decision":"go","verdict":"SAFE","risk_score":15,"liquidity_usd":1871488,"impact_pct_of_pool":0,"flags":["owner can mint new supply"]}`

Any Base ERC-20 on the paid route `/gate/swap` is $0.008/call via x402 (USDC on Base, no account/key). Measured so far: p50 ~1.3s, p95 ~2.0s, 100% ok over a small sample, no SLA. Limit: heuristic signal, doesn't measure buy/sell tax %. If a rule like this is useful for the project, happy to write the policy-rule snippet for your engine; if not, no worries — close freely.
