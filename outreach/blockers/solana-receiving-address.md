# Provide a Solana USDC receiving address
Why: ~70% of x402 volume is on Solana (Aug 2026 reports); we only accept Base, so most buyer bots cannot pay us.
Steps: 1) Create a Solana wallet (Phantom or `solana-keygen new`). 2) Save the public address to outreach/solana_payto.txt (public address only, never the seed). 3) Next cycle adds a Solana `accepts` entry to the paid routes.
Note: Solana revenue will not show in the Base-wallet oracle; it would need to be bridged or tracked separately.
