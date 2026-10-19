One more off-chain option for the *token* half, usable today from an AgentKit action with no contract deployment: Grey Ridge's x402 gate (`GET /gate/swap`, $0.008 USDC on Base, no key) returns allow/review/block from a live `eth_call` state-override transfer simulation + proxy/mint/pause/blacklist/fee-setter selector scan + owner-renounce check. Free preview that accepts any Base token (3/IP/day):

```
curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=<0x…>"
```

A pay-and-guard example (agent pays the 402 inline, then swaps only on `allow`) is in https://github.com/rezearcher/x402-data-api/tree/main/docs/examples/swap-gate . Happy to package it as an `ActionProvider` PR if maintainers would take a community provider.
