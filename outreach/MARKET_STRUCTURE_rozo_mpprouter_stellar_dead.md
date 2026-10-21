# rozo-mpprouter (apiserver.mpprouter.dev) — chain-mismatch DEAD lever for us (researched 2026-10-21, cycle 64)

MPP Router is a live x402 router (675 services, SCF Tranche 3) with self-serve provider onboarding — on first look the proven-converting "partner registry" shape. It is NOT usable by us. Recorded so no future cycle re-chases it.

## Why dead
- `GET https://apiserver.mpprouter.dev/v1/services/catalog` → `supported_payment_methods` = **Stellar only** (`stellar.mpp`, `stellar.x402` on `stellar:pubnet`). All 675 proxied services settle `stellar-mainnet`. `/health` shows Stellar router pools + one `tempo` (EVM, 0x4374b2…) pool — no Base.
- Two onboarding paths, both Stellar-gated:
  1. **Runtime provider registry** (`src/services/provider-registry.ts`): self-serve, no manual approval — BUT verification requires "a real paid call through the full production chain" where "agent wallet pays Stellar USDC → router settles → router pays upstream." A 402 probe is explicitly NOT verification. The router would have to pay our upstream; its funding rail is Stellar.
  2. **Curated third-party directory** (`src/services/third-party-directory.ts`): listing-only, settlement DIRECT to operator at their own resource_url (no chain mismatch on the *buyer→us* leg!) — BUT each entry requires (a) written approval exchanged with the MPP founder AND (b) a ROZO-funded **evaluation purchase** of each route, recorded as a `evaluationTxHash`. Those tx hashes are **Stellar** (Horizon). The router funds evaluation in Stellar, so it can only evaluate providers that accept Stellar.
- Our only competitor listed there — **agent402** (agent402.tools, our Base rival) — is listable precisely because it went multi-chain and publishes a **Stellar** 402 (payTo `GDNJ…`, asset USDC Stellar SAC). We are Base-USDC only (eip155:8453).

## Takeaway
To appear on MPP Router we'd need a Stellar 402 endpoint (new chain/wallet) — demand-gated, no named buyer asked, and Stellar settlement would be invisible to our Base wallet oracle. Out of scope per ground rules (Base-only until a named buyer asks). Same structural root as the #1 documented NO: the non-CDP x402 agent ecosystem is Stellar/Solana; our Base-only posture is the conversion ceiling.

Also swept this cycle (same search): ItachiDevv/ClawVille (Solana merchant wallet, x402 consumer not a partner registry) and alsk1992/CloddsBot (Solana token-launch bot) — neither a Base-fit partner registry.
