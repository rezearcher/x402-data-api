# $20 USDC Bounty — First External Caller of x402-data-api

**Thesis (Division-validated):** $0 revenue is a DISTRIBUTION failure, not a product failure.
Payment rail is verified working; demand is real (~79k paid x402 calls/day, ~1,160 buyers/hr on Base).
Passive listing is broken ecosystem-wide. The fix is an ACTIVE incentive that pulls a real external
developer through the full earning path. Bounded downside ($20 of the $32 wallet), uncapped upside
(a repeatable organic-acquisition playbook + the first real dollar).

## Offer
> **$20 USDC bounty.** First external developer to call any paid `x402-data-api.sigrunner.workers.dev`
> endpoint from their OWN wallet (not ours), post the tx hash publicly tagging the API, gets $20 USDC
> sent to their wallet — on top of whatever their call returns. Build an agent that actually uses it
> and I'll also amplify your project.

## Where to post (warmest-first, from x402-outreach-targets.md)
1. x402 / agent builder Discords & X (reply under Heurist @heurist_ai, inference.sh @inference_sh,
   Bankr @bankrbot, AgentLISA, Loomlay x402 threads).
2. GitHub issues on x402 agent-kits whose users already pay (atxp-dev/atxp, gatefareio/mcp-server,
   dabit3/x402-starter-kit) — "here's a live endpoint + a $20 bounty to try it".
3. Farcaster agent channels (Neynar, Builders Garden cohort).

## Autonomous claim verification (no human adjudication)
A Hermes cron scans Base USDC `Transfer`/`AuthorizationUsed` events to PAY_TO
(0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10), filters out our own known wallets + probe/farm bots
(reuse docs/REVENUE_LEDGER_AUDIT.md bot-fingerprint logic + onchain-probe-bot-fingerprint skill),
and the FIRST clean external payer is the winner. Payout tx is the only human/capital action.

## The one gate that is genuinely Rez's
Deploying the $20 (capital) is the legal gate. Everything else — posting, claim-scan, winner-pick —
runs autonomously. Rez's atom: "yes, fund the $20 bounty."
