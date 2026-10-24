# Rez atom — publish the three framework swap-gate plugins to npm

**Why this needs you:** `npm publish` requires *your* npm account identity. That is the
only gate. All three packages are complete, offline-typechecked, and tested against the
**live** deployed Worker (each suite requires a real x402 402 from production). This is
Line A move **A1** — the install-once-pay-per-trade funnel that actually moves the USDC
wallet oracle. Shipping to three ecosystems (ElizaOS, Vercel AI SDK, LangChain.js) widens
the top of that funnel without new code per install.

## What's done (builder, autonomous — all on `main`)

Each wraps the same Base-native `/gate/swap` route (honeypot + sellability + admin-control
+ liquidity-vs-size), paid inline per call with x402 USDC ($0.008), and **fails closed**
(proceed:false on 402/outage/bad token). All three share one dependency-free `gate.mjs`
core + `client.ts` payment layer + core test suite, so the money-logic is identical and
proven across frameworks.

| Package | Dir | Framework surface | Verified |
|---|---|---|---|
| `plugin-swap-gate` | `integrations/elizaos-plugin-swap-gate/` | ElizaOS `Action` `CHECK_TOKEN_BEFORE_SWAP` | typecheck clean, tests green (+ live) |
| `@grey-ridge/vercel-ai-swap-gate` | `integrations/vercel-ai-sdk-swap-gate/` | AI SDK v5 `tool` (`inputSchema`) | tsc exit 0, 16/16 tests (GATE_LIVE=1, 0 skipped) |
| `@grey-ridge/langchain-swap-gate` | `integrations/langchain-swap-gate/` | LangChain `tool` (`content_and_artifact`) | tsc exit 0, 16/16 tests (GATE_LIVE=1, 0 skipped) |

## Your steps (one-time, ~10 min total)

```bash
npm login    # your npm identity  ← the only gate, do this once

# 1) ElizaOS (publishes to npm AND opens the elizaos-plugins/registry PR)
cd ~/projects/x402-data-api/integrations/elizaos-plugin-swap-gate
npm install && npm run build && npm test
npx elizaos publish --test   # dry run: auth, structure, images
npx elizaos publish          # npm package + GitHub repo + registry PR

# 2) Vercel AI SDK
cd ~/projects/x402-data-api/integrations/vercel-ai-sdk-swap-gate
npm install && npm run build && npm test
npm publish --access public  # scoped @grey-ridge → needs --access public

# 3) LangChain.js
cd ~/projects/x402-data-api/integrations/langchain-swap-gate
npm install && npm run build && npm test
npm publish --access public
```

(The `@grey-ridge` scope is published once with `--access public`; later updates are just
`npm version patch && npm publish`.)

## After they're live (marketing / next cycle)

- List the `/gate/swap` route in CDP Bazaar / Circle ranked for "pre-trade token safety",
  linking the three install surfaces.
- Repeat-dollar milestone: one installed agent paying `/gate/swap` >1× = first Line-A
  repeat payer on the revenue sensor (non-self wallet inflow).

Legal gates (bounty submit / real capital) untouched. This is an account-identity gate only.
