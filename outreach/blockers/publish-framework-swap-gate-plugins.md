# ⚠ PARTIAL — npm packages exist but STALE/BROKEN at 0.1.0; git-install is the working path

> **Reality (verified 2026-10-24):** the `@grey-ridge/*` packages resolve on npm but are pinned
> at `0.1.0` — the **original fail-closed build**. Installed-from-npm 0.1.0 has **zero**
> degrade-open markers (`fetchGateOrPreview`/`activation`/`preview` absent in its dist), so on a
> keyless wallet it fails closed / 402s instead of returning the free preview. Local source is
> `0.1.3` with the degrade-open fix. **`npm i @grey-ridge/<plugin>` currently installs the broken
> build** — every install surface we control has been repointed to the git path below.
>
> **The real gate is npm 2FA (EOTP), not `npm login`.** Re-confirmed 2026-10-24: `npm whoami` =
> `grey-ridge` (logged in), but `npm publish` **and** `npm deprecate` both return `code EOTP`
> ("requires a one-time password from your authenticator"). `npm login` does NOT bypass this —
> the account's 2FA is set to *auth-and-writes*. To unblock hands-free publishing of 0.1.3, Rez
> must either (a) create a **Granular Automation token** (2FA-bypassing) and put it in `~/.npmrc`,
> or (b) configure **Trusted Publishing (OIDC)** per package on npmjs.com so `publish-npm.yml`
> can push. Until then git-install is canonical and nothing is blocked on npm.

---

> **Update 2026-10-23: the npm gate is removed. All three plugins are installable TODAY**,
> with no npm account, straight from their standalone GitHub repos (build committed, so no
> compile step):
>
> ```bash
> npm install github:rezearcher/plugin-swap-gate          # ElizaOS
> npm install github:rezearcher/langchain-swap-gate        # LangChain.js
> npm install github:rezearcher/vercel-ai-swap-gate        # Vercel AI SDK
> ```
>
> Each was verified by a clean `npm install` from GitHub into an empty project + a runtime
> import (plugin/tool object resolves, deps install). A latent blocker was also fixed this
> pass: the `@x402/*` deps were pinned at a **nonexistent `^0.5.0`** so the packages could
> never actually install — corrected to `^2.15.0` (the Worker's x402 v2 floor) and the full
> payment path smoke-tested end-to-end against the live Worker (402→EIP-3009 sign→resubmit).
>
> So `npm publish` is no longer a gate for *using* the plugins — it is now only a
> **discoverability upgrade** (registry search / the ElizaOS plugin registry). Do it when
> convenient; nothing is blocked on it.

**Why you'd still do it (optional):** `npm publish` + the ElizaOS registry PR put the plugins
in the catalogs devs browse, which marketing can then point at. This is Line A move **A1** —
the install-once-pay-per-trade funnel that moves the USDC wallet oracle. All three packages
are complete, build clean against the real framework + x402 v2 deps, and are tested against
the **live** deployed Worker (each suite requires a real x402 402 from production).

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
# Gate is npm 2FA (EOTP), not login. Pick ONE:
#   (a) create a Granular Automation token (bypasses 2FA) → put in ~/.npmrc, OR
#   (b) run each publish below interactively and pass --otp=<code> from your authenticator.

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
