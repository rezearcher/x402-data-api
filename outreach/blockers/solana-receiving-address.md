# Provide a Solana USDC receiving address
Why: ~70% of x402 volume is on Solana (Aug 2026 reports); we only accept Base, so most buyer bots cannot pay us.
Steps: 1) Create a Solana wallet (Phantom or `solana-keygen new`). 2) Save the public address to outreach/solana_payto.txt (public address only, never the seed). 3) Next cycle adds a Solana `accepts` entry to the paid routes.
Note: Solana revenue will not show in the Base-wallet oracle; it would need to be bridged or tracked separately.

Feasibility (checked 2026-10-19): `@x402/svm` 2.28.0 is on npm (repo currently uses @x402/evm/hono/extensions only; NETWORK is hardcoded eip155:8453 at src/index.ts:86). Adding Solana = register the SVM server scheme + a second `accepts` per route + a facilitator that supports Solana mainnet (PayAI/Dexter).

Facilitator check (2026-10-19): PayAI /supported lists solana mainnet (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, exact). So only the receiving address is missing.
