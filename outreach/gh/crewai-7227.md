Another option for the same slot, if you want a second backend to compare: Grey Ridge's x402 Base token-security endpoint (`/chain/token-security`, $0.009/call USDC on Base) returns a risk_score + verdict (clear/review/block) from a live `eth_call` state-override transfer simulation plus a proxy/mint/pause/blacklist/fee-setter selector scan and owner-renouncement check. There's a free preview that takes any Base token address (3/IP/day), so you can see the response shape before wiring a `BaseTool`:

```
curl "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"
```

Discovery: https://x402-data-api.sigrunner.workers.dev/.well-known/x402 · OpenAPI: /openapi.json. Happy to contribute a CrewAI tool wrapper PR if the maintainers want one.
