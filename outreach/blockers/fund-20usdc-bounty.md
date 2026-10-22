# Fund $20 USDC first-external-payer bounty (capital gate)
Why: a paid incentive to the first external caller; see outreach/BOUNTY_20USDC_FIRST_PAYER.md.
1. Send 20 USDC (Base) from a non-receiving wallet to the bounty escrow named in that file, only if you accept the capital spend.

## NEW (2026-10-22) — the ROI of this bounty just went up: the first genuine settle COMPOUNDS
Live ground-truth from the agent402.tools router (GET /api/x402/seller-trust?origin=...&trial=1
+ /api/index?seller=...): our per-route `routerDispatchEligible=false`, reason
`settlement_self_funded — below the settlement floor`, on ALL 64 good routes. The router
**excludes self-funded settlements** (our buyer-wallet→receiver test traffic counts as 0), so our
46 observed on-chain settles are worth nothing to it. Both router lanes are therefore blocked:
 - proven lane: needs 50 GENUINE (non-self) on-chain settles.
 - unproven lane (Base, capped $0.01/call, tried after every proven seller): flips `eligible`
   the **instant ONE genuine external settlement lands**, then the router starts feeding us
   $0.01/call unproven traffic that compounds toward the 50-call proven floor.

Our side is verified-ready: live 402 is cleanly payable (EIP-712 domain name "USD Coin" matches
the USDC asset on Base; correct payTo; request contracts already read from our OpenAPI). There is
**nothing left to build** to be routable — the single gate is one genuine external dollar.

Implication: a $20 bounty that buys the first ~N genuine external calls is not just "the first
dollar" — it is the key that switches on a standing, zero-marginal-cost router distribution channel
(agent402 = 5,784 sellers / 2,685 Base payees). That raises the bounty's expected value well above
its face cost. Still a capital gate (Rez only); noted here so the decision carries the full upside.
