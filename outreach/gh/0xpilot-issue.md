0xpilot's research agent already pulls GoPlus for rug indicators. Two things GoPlus can't give a tool-use agent: (1) a single decision (`go/hold/block`) instead of 20 string flags to interpret, and (2) coverage for brand-new Base tokens GoPlus hasn't indexed, since ours simulates a sell live from chain state.

Free preview, no wallet/key (3 real-token checks/IP/day):
`curl -s "https://x402-data-api.sigrunner.workers.dev/gate/swap/preview?token=0x<BASE_TOKEN>"`
`curl -s "https://x402-data-api.sigrunner.workers.dev/chain/token-report/preview?token=0x<BASE_TOKEN>"` (full SAFE|CAUTION|AVOID report with honeypot/sellable/liquidity/admin-control fields)

Easy to drop in as one more Anthropic tool next to your GoPlus client (`name: "base_token_gate"`, input `{token}`, returns the JSON above). Paid route for unattended use is $0.008–$0.01/call in USDC on Base via x402. If useful I'll write the exact tool definition against your `app/clients/` layout — which token do you want to try first?
