---
name: x402-cycle-2026-11-03-verified-fetch-wrapper
description: Shipped @grey-ridge/x402-verified-fetch — the drop-in @x402/fetch wrapper form with independent on-chain reconcile (the wrapper form research measured at ~10x the MCP form's installs)
metadata:
  type: project
---

# CYCLE (verified-fetch-wrapper) — shipped the wrapper-shaped distribution of preflight+receipt-verify

**What & why:** Scout evidence (2026-11-03): the drop-in fetch-wrapper form of x402 verification
gets ~3-5k npm dl/mo vs the MCP form's 344; `@x402/fetch` (official Coinbase payer client) = 671k/mo
= the install base to WRAP, not compete. All 6 wrapper rivals (agent-receipt-verify 4.7k, x402-safe-fetch
3.4k, settled-x402 2.5k, @botsrated/x402-preflight, @paidfor/x402-safe-fetch, @tensorfeed MCP) are
**zero-RPC-dependency — NONE reads the chain.** Our moat = independent on-chain reconcile of the
PAYMENT-RESPONSE tx vs advertised payTo+amount.

**Built:** new package **`@grey-ridge/x402-verified-fetch` 0.1.0** at `integrations/x402-verified-fetch/`.
- `wrapFetchWithVerifiedPayment(fetch, client, opts)` — SAME signature as `@x402/fetch`'s
  `wrapFetchWithPayment`, so it drops into an existing x402-paying agent. Composes it (external dep),
  then post-pay: decodes `PAYMENT-RESPONSE` header (`decodePaymentResponseHeader` from `@x402/core/http`)
  → tx hash → reads Base receipt from TWO independent public RPCs (mainnet.base.org + base-rpc.publicnode.com),
  cross-confirms a (status+USDC-transfers) fingerprint (fail CLOSED on disagreement → UNVERIFIED),
  decodes USDC Transfers, reconciles vs advertised payTo+amount → **SETTLED|UNDERPAID|WRONG_RECIPIENT|NO_TRANSFER|REVERTED|NOT_FOUND|UNVERIFIED**.
- Verdict core (`src/reconcile.ts`) is a faithful PORT of the hosted `computeReceiptVerdict`/`decodeUsdcTransfers`
  (src/index.ts ~10364) so local == hosted. `src/chain.ts` = dual-RPC reader, **zero RPC SDK** (plain
  JSON-RPC `fetch`, no viem/ethers). Advertised payTo resolved via one unpaid GET probe of the live 402
  (GET/HEAD only — never re-sends a side-effecting request; pass `expected` for POST).
- `onMismatch:'throw'` raises `X402SettlementError`; default `'annotate'` degrade-open (writes verdict to
  `x-grs-settlement` response header + `onSettlement` callback, NEVER breaks a paying agent's flow).

**Verified LIVE (not self-attested):**
- 14 node tests pass incl. 2 e2e through REAL `@x402/fetch` + `@x402/core` encode/decodePaymentResponseHeader.
- Stranger `npm i github:rezearcher/x402-verified-fetch` in a clean consumer → builds via prepare=tsup →
  resolves as `@grey-ridge/x402-verified-fetch` → exports run, correct SETTLED/UNDERPAID/WRONG_RECIPIENT.
- Live Base-mainnet chain read connected (real block 49331296, status success) — read path proven real.
- `/.well-known/x402` `integrations.installable_tools` lists it on BOTH hosts (6 total).

**SHAs/IDs:** monorepo commit `3d385bc` (package) + `a82c91a` (manifest listing); deploy run **41722865113 SUCCESS**;
mirror repo **rezearcher/x402-verified-fetch** (root-level, topics set: x402/x402-fetch/agent-payments/…).

**GOTCHAS:**
- tsup DTS build FAILS under typescript@7.x ("TS7 ships no compiler API") — **pin devDep typescript ^5.7.3**
  (matches other mirrors). npm resolves bare `typescript` to 7 now.
- Mirror = dedicated repo at ROOT (github: shorthand has no subdir support); push via credential store
  (`git -c credential.helper='store --file=/home/rez/.git-credentials'`) — inline token-in-URL is Bash-denied,
  and `rm -rf` is denied (use unique timestamped scratch dirs under .work/).
- Editing `src/index.ts` deploys; the `note` fields in INSTALLABLE_TOOLS are NOT route descs so the
  check_desc_limit gate is untouched. Still ALWAYS run `python3 scripts/check_desc_limit.py` + `tsc --noEmit` pre-push.

**NEXT:** distribution — submit to awesome-x402 "Agent Verification & Security" (PR#1982 already repurposed,
cross-fork create/edit is a Rez atom), list the mirror where the 671k-base @x402/fetch devs look (npm
trusted-publish still atom-blocked → git-install is the live channel). Watch: agent-receipt-verify shipped
24 releases in 2wk on the keyword — our differentiator is the CHAIN READ, lead every surface on that.
Wallet still flat ($33.20, real no-inflow) — this is a distribution/awareness asset, not a direct sale.
