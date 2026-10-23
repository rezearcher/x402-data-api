# Rez atom — publish `plugin-swap-gate` to npm + the ElizaOS registry

**Why this needs you:** publishing requires *your* npm account identity and a scoped
GitHub token. That is the only gate. The package is complete, typechecked, tested
(incl. a live check against the deployed Worker), branded, and registry-metadata-ready.
This is Line A move **A1** — the install-once-pay-per-trade funnel that actually moves
the USDC wallet oracle.

## What's done (builder, autonomous)

`integrations/elizaos-plugin-swap-gate/` — a real, installable ElizaOS plugin:
- `src/index.ts` — `Plugin` export (`plugin-swap-gate`).
- `src/actions/checkTokenBeforeSwap.ts` — typed `Action` `CHECK_TOKEN_BEFORE_SWAP`
  wrapping `/gate/swap`, with sizing-aware go/no-go.
- `src/gate.mjs` — dependency-free core (URL builder, parser, trade evaluator); single
  source of truth, unit-tested offline **and** against the live endpoint.
- `src/client.ts` — x402-wrapped fetch (pays $0.008 USDC inline).
- `package.json` — name `plugin-swap-gate`, keywords `plugin,elizaos`, custom description,
  `agentConfig.pluginParameters`, peer `@elizaos/core`.
- `images/logo.jpg` (400×400, 20KB), `images/banner.jpg` (1280×640, 58KB).
- `README.md` — competitor table (GoPlus/1inch), honest scope, install/config/use.
- `test/gate.test.mjs` — 10 tests green; typecheck clean (`tsconfig.check.json`).

## Your steps (one-time, ~5 min)

```bash
cd ~/projects/x402-data-api/integrations/elizaos-plugin-swap-gate
npm install            # pulls @elizaos/core, @x402/*, viem, tsup
npm run build          # tsup → dist/
npm test               # 10 green (set GATE_LIVE=1 to require the live check)
npm login              # your npm identity  ← the gate
npx elizaos publish --test   # dry run: validates auth, structure, images, description
npx elizaos publish          # creates the npm package + GitHub repo + opens the registry PR
```

`elizaos publish` opens a PR to `elizaos-plugins/registry` automatically (review 1–3 days).
For later updates: bump version, `npm publish`, push — the registry re-syncs from npm.

## After it's live (marketing / next cycle)

- List the `/gate/swap` route in CDP Bazaar / Circle ranked for "pre-trade token safety".
- Repeat-dollar milestone: one installed agent paying `/gate/swap` >1× = first Line-A
  repeat payer (revenue sensor, non-self wallet).

Legal gates (bounty submit / real capital) untouched. This is an account-identity gate only.
