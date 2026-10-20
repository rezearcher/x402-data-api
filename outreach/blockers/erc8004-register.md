# Register Grey Ridge on ERC-8004 (Base)
Why: rival true402 appears in https://erc-8004.quicknode.com/agents/base-mainnet/37406; we are absent from every on-chain agent registry.
Steps: 1) look up the current Identity Registry address on Base (erc-8004 spec / quicknode explorer "register" page). 2) From the buyer wallet 0xC4852c26...2d1e (needs ~$0.05 ETH on Base) call register(agentURI) with agentURI = our agent card URL (https://api.greyridgesignals.ai/.well-known/agent-card.json; verify it resolves first). 3) Record the agent id in STRATEGY.md.
Cost: sub-cent gas. Gate: spends wallet funds, so Rez approves.
