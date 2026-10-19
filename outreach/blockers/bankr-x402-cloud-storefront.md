# Bankr x402 Cloud storefront (optional, after PR #796 outcome)
Why: Bankr agents discover and pay x402 endpoints hosted at x402.bankr.bot. Payout address can be set to our receiving wallet 0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10.
Steps: 1) npm i -g @bankr/cli; bankr login (email). 2) bankr x402 init; bankr x402 add gate-swap. 3) Paste a handler that implements the gate logic directly (see src/ in this repo), set price 0.008, payout address = receiving wallet. 4) bankr x402 deploy.
Do this only if PR https://github.com/BankrBot/skills/pull/796 merges or draws interest.
