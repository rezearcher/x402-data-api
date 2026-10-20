Tangential to the guard thread above, one input that's missing from allow/review/deny on swaps: whether the **output token itself** is safe (honeypot, unsellable, transfer tax, owner-controlled mint). Amount/slippage/recipient limits don't catch a token that can't be sold back.

We run a pay-per-call (x402, USDC on Base) pre-trade gate for exactly that, returning `go|hold|block` JSON. Free, no-wallet sample you can curl now:

`curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=weth"` -> `{"decision":"go","verdict":"SAFE","risk_score":0,...}`

Full call for any Base ERC-20 is $0.008: `GET /gate/swap?token=<0x...>&side=buy&notional_usd=100`. Measured latency/uptime (window stated): https://github.com/rezearcher/x402-data-api/blob/main/docs/STATUS.md

Scope limit: Base only today. If intents-cli routes any Base-asset swaps and you'd want a different shape (e.g. a library call instead of HTTP), tell me the token you'd test first and I'll paste the live result.
