# ARCHITECTURE — x402-data-api

**Source of truth for what is actually shipped.** Rewritten 2026-07-29 from a full read of every
source file in the tree at commit `90cadd1`. Counts, prices, route lists, and tool lists below were
read out of the code — not copied from prose — and cross-checked against the **live deployment**
(see [§16 Verification evidence](#16-verification-evidence)). Where another doc conflicts with the
code, the code wins and the conflict is recorded in [§13 Doc-drift corrections](#13-doc-drift-corrections).

---

## 1. What it is

A pay-per-call data + security API for AI agents, settled inline in USDC on **Base mainnet**
(`eip155:8453`) over the [x402 protocol](https://x402.org). No account, no API key, no
subscription on the agent rail: a caller hits an endpoint, gets **HTTP 402** with a signed
challenge, signs an EIP-3009 authorization, retries, and receives the data in the same request.
Every data domain also exposes a **free preview** so a discovering agent can taste the output
before paying.

- **Deployed:** `https://x402-data-api.sigrunner.workers.dev`
- **Source:** `https://github.com/rezearcher/x402-data-api` — public since 2026-07-19, MIT
- **Runtime:** Cloudflare Workers (`nodejs_compat`, `compatibility_date = 2025-06-01`)
- **Framework:** Hono 4 + `@x402/hono` `paymentMiddleware` / `x402ResourceServer`
- **MCP endpoint:** `POST /mcp` (streamable-http), 22 tools
- **A2A endpoint:** `GET /.well-known/agent-card.json`

Two payment rails are wired (§5, §6): the **agent rail** (x402/USDC, live) and the
**human rail** (Stripe subscription → KV-stored API key, code-complete, secrets not yet set).

## 2. Repo map

| Path | Lines | What it is |
|---|--:|---|
| `src/index.ts` | 4,652 | **The entire Worker.** Single file: routes, payment gate, all data/compute logic, MCP server. |
| `mcp-client/` | 149 (src) | Standalone npm package `x402-data-api-mcp` — local **stdio** MCP client that proxies to the deployed Worker (§10). |
| `apify-actor/` | 410 (src) | Python Apify Actor `grey-ridge-base-onchain` — wraps the free preview endpoints + public RPC for the Apify marketplace (§11). |
| `scripts/` | 726 | `deploy.sh` (token-resolving `wrangler deploy`), `auto-merge.sh` (kanban worktree merge hook), `verify_revenue_ledger.py` (on-chain revenue forensics). |
| `.metrics/` | 91 | `compute_revenue_usd.py` producer + the two output files it writes. |
| `seed_*.js`, `register_x402scan.js`, `fund_buyer.js`, `smoke.js`, `test_payment_flow.js` | ~950 | Human-run Node ops scripts — catalog seeding, registry registration, wallet funding, paid smoke tests (§12). |
| `docs/` | 16 files + handoffs | Distribution, market, and audit narrative docs. This file supersedes their code-level claims. |
| `wrangler.toml`, `package.json`, `tsconfig.json` | — | Worker config, npm deps, strict TS (`noEmit`). |

**Not in git** (`.gitignore`): `node_modules/`, `.wrangler/`, `.dev.vars`, `buyer-wallet.json`,
`seed_cdp_pm.js`, `.mcp-registry-key`, `/.worktrees/`. Note `seed_cdp_pm.js` exists on disk but is
**untracked** — it is not part of the public repo despite appearing in older doc inventories.

The Worker is deliberately **one file with no build step beyond `wrangler`**. There is no bundler
config, no module split, no test framework. `npm run typecheck` (`tsc --noEmit`) is the only static
gate and it currently passes clean.

## 3. Runtime & configuration

`wrangler.toml`:

| Setting | Value | Notes |
|---|---|---|
| `name` / `main` | `x402-data-api` / `src/index.ts` | |
| `compatibility_flags` | `["nodejs_compat"]` | Required by `@coinbase/cdp-sdk/auth` (JWT minting). |
| `vars.PAY_TO` | `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10` | Base wallet Rez controls; overridable via `wrangler secret put PAY_TO`. |
| `vars.FACILITATOR_URL` | `https://facilitator.xpay.sh` | |
| `vars.NETWORK` | `eip155:8453` | Base mainnet. |
| `vars.FACILITATOR_MODE` | `xpay` | **Do not set to `cdp`** — see §5. |
| `kv_namespaces[0]` | binding `API_KEYS`, id `b48622…c874` | Wired 2026-07-29 (commit `90cadd1`); backs the Stripe rail (§6). |

`Env` type (`src/index.ts:16-29`) — everything beyond `PAY_TO` is optional, and every consumer
degrades gracefully when absent:

- `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` — Worker secrets. Only used by `/internal/cdp-probe` and
  `/internal/cdp-settle-raw`; absent → those two routes return 500 and nothing else is affected.
- `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` — absent → the webhook replies
  `200 ok (unconfigured)` so Stripe does not retry during setup.
- `API_KEYS` (KVNamespace) — absent → API-key issuance/lookup is skipped and every caller falls
  through to the x402 gate.

Local dev: copy `.dev.vars.example` → `.dev.vars`, `npm run dev`. Deploy: `npm run deploy`, or
`bash scripts/deploy.sh` which resolves `CF_WORKERS_TOKEN` (the token with Workers:Write scope)
from the environment or `~/.hermes/.env` before invoking `npx wrangler deploy`.

## 4. Request pipeline

Hono composes matched handlers **in registration order**, which this file uses as the primary
access-control mechanism. Everything free is registered *above* the gate; everything paid is
registered *below* it.

```
                    src/index.ts registration order
 ─────────────────────────────────────────────────────────────────────────────
  :98   GET  /health                                    ┐
  :107  GET  /                       (HTML landing)     │
  :198  GET  /internal/cdp-probe                        │  registered ABOVE the
  :232  POST /internal/cdp-settle-raw                   │  gate → these handlers
  :274  GET  /.well-known/402index-verify.txt           │  return before the
  :280  GET  /.well-known/mcp-registry-auth             │  payment middleware is
  :287  GET  /.well-known/x402                          │  ever composed in.
  :354  GET  /.well-known/agent-card.json               │  Free by position.
  :507  GET  /llms.txt                                  │
  :550  GET  /openapi.json                              │
  :611  GET  /crypto/prices/preview                     │
  :622  GET  /crypto/funding/preview                    │
  :634  GET  /defi/yields/preview                       │
  :646  GET  /pm/markets/preview                        │
  :1384 GET  /token-safety          (HTML landing)      │
  :1498 POST /stripe/webhook                            ┘
 ─────────────────────────────────────────────────────────────────────────────
  :1574 app.use(...)  ◄── THE GATE
          1. FREE_PATHS short-circuit + /.well-known/* prefix skip
          2. API-key bypass:  ?api_key=sk_… → KV lookup → credit decrement
          3. /mcp JSON-RPC peek: free unless method === "tools/call"
                                 with a non-FREE_TOOLS tool name
          4. ensureInitialized(env) → selectResourceServer(env)
          5. cachedMiddleware = paymentMiddleware(makeRoutes(PAY_TO), …)
 ─────────────────────────────────────────────────────────────────────────────
  :1654 … :4634   all paid routes + the remaining previews + POST /mcp
                  (previews registered here are free because makeRoutes()
                   simply doesn't declare them — the middleware passes
                   undeclared paths straight through)
```

Details worth knowing:

- **`makeRoutes(payTo)` (`:739-1354`)** is the single declaration of the paid surface — price,
  network, `payTo`, human description, and a Bazaar `declareDiscoveryExtension()` block per route.
  It is called once and the resulting `paymentMiddleware` is memoized in `cachedMiddleware`
  (`:737`), so the route map is built once per isolate, not per request.
- **`ensureInitialized` (`:728`)** memoizes resource-server startup in `initPromise`. The x402
  middleware is constructed with `syncFacilitatorOnStart=false` because init is already awaited
  here; doing it twice was the original failure mode.
- **The `FREE_PATHS` set inside the gate** (`/`, `/health`, `/token-safety`, `/stripe/webhook`) is
  belt-and-braces — all four are registered above the gate and never reach it. Harmless redundancy,
  documented so nobody "fixes" one layer and assumes the other still holds.
- **`/internal/*` is unauthenticated.** Both internal routes are free by position and neither checks
  a shared secret; they are gated only by the fact that they 500 without CDP secrets in env, and
  `/internal/cdp-settle-raw` merely forwards a *caller-supplied, caller-signed* payment to CDP.
  Treat that as intentional-but-noted, not as a designed authz boundary.

## 5. Payment architecture (agent rail — x402)

```
agent ──GET /chain/gas-price──►  Worker
                                  │ paymentMiddleware: route declared, no payment
      ◄──402 + x402 v2 challenge──┤   (network eip155:8453, asset USDC, payTo, price)
        (sign EIP-3009 auth)      │
      ──retry w/ X-PAYMENT──────► │
                                  ├──verify──► xpay facilitator ──► Base mainnet
                                  ├──settle──►      (~1s)
      ◄──200 + JSON data──────────┘
```

- **Facilitator:** xpay, non-custodial (`FACILITATOR_URL = https://facilitator.xpay.sh`,
  `src/index.ts:37`). No Coinbase/CDP account is required to take money.
- **Resource server** (`:664-676`): `new x402ResourceServer(new HTTPFacilitatorClient({url}))`
  registered with `ExactEvmScheme`. `selectResourceServer(env)` (`:703`) is where a CDP-backed
  server *would* be swapped in when `FACILITATOR_MODE === "cdp"`.
- **The CDP wall — the single most important operational constraint.** Routing live settlement
  through CDP breaks on Cloudflare Workers: the `@x402` resource server validates the Bazaar
  discovery extension with **ajv**, which compiles schemas via `new Function` — blocked in the
  Workers runtime. `FACILITATOR_MODE` must stay `xpay`. CDP is reachable **only** through
  `POST /internal/cdp-settle-raw` (`:232`), which mints a CDP JWT and POSTs a pre-signed
  `{paymentPayload, paymentRequirements}` pair straight at the CDP facilitator's `/verify` then
  `/settle`, bypassing the resource server entirely. That path exists solely so routes get
  catalogued in the CDP x402 Bazaar (§12).
- **Discovery extensions.** Every entry in `makeRoutes` carries `declareDiscoveryExtension({...})`
  with an input schema and a realistic output example, so the live 402 challenge itself advertises
  the route to Bazaar crawlers. Query-method routes pass `method: "GET"` and are cast to the
  package's narrower exported path-variant type — a `tsc`-only accommodation with no runtime effect
  (comment at `:941-944`).

## 6. Payment architecture (human rail — Stripe → API key)

Shipped in commit `ae27bbe`; KV binding wired in `90cadd1`. Code-complete, **not yet activated**
(Stripe secrets unset — §14).

1. `GET /token-safety` (`:1384`) — standalone HTML landing page selling the token-security scanner
   to humans. Free plan (preview endpoint) / Pro $9.99 per month for 100 checks. The Subscribe
   button is still a JS `alert()` placeholder — there is **no Checkout Session creation route** in
   the Worker; the Stripe payment link must be created out-of-band.
2. `POST /stripe/webhook` (`:1498`) — verifies Stripe's `v1` signature by recomputing
   `HMAC-SHA256(timestamp + "." + rawBody, STRIPE_WEBHOOK_SECRET)` via WebCrypto and comparing hex.
   On `checkout.session.completed` it mints `sk_` + 20 random bytes (`generateApiKey`, `:1361`) and
   writes an `ApiKeyRecord` to KV: `{key, stripe_session_id, customer_email, credits_remaining: 100,
   created_at, expires_at: +30d}`.
   *Signature comparison is a plain `!==` string compare, not constant-time.*
3. **API-key bypass** inside the gate (`:1581-1595`) — `?api_key=sk_…` → KV `get` → if unexpired and
   `credits_remaining > 0`, decrement, write back, and `return next()`, skipping x402 entirely.
   *Read-modify-write is non-atomic; concurrent calls on one key can double-spend a credit.
   Acceptable at this volume, noted so it isn't rediscovered as a bug.*
4. `PLANS` (`:1376`) currently holds exactly one tier: `pro` — $9.99, 100 monthly credits,
   price id read from `STRIPE_PRICE_ID`.

## 7. HTTP surface

### 7.1 Paid — 18 `GET` routes + `POST /mcp`

All declared in `makeRoutes()`; prices are the literal values in that function.

| Route | Price | Handler | MCP tool? |
|---|--:|---|:--:|
| `GET /crypto/prices` | $0.001 | `:2851` | `crypto_prices` |
| `GET /crypto/funding` | $0.001 | `:2615` | `crypto_funding` |
| `GET /defi/yields` | $0.001 | `:2752` | `defi_yields` |
| `GET /pm/markets` | $0.005 | `:2401` | `pm_markets` |
| `GET /chain/block-number` | $0.001 | `:2941` | `chain_block_number` |
| `GET /chain/gas-price` | $0.001 | `:2992` | `chain_gas_price` |
| `GET /chain/balance` | $0.001 | `:3044` | `chain_balance` |
| `GET /chain/token-balance` | $0.001 | `:3119` | `chain_token_balance` |
| `GET /chain/tx` | $0.001 | `:3157` | `chain_tx` |
| `GET /chain/receipt` | $0.001 | `:3188` | — |
| `GET /chain/code` | $0.001 | `:3272` | — |
| `GET /chain/wallet` | $0.003 | `:3297` | `chain_wallet` |
| `GET /chain/token-security` | $0.02 | `:3770` | `chain_token_security` |
| `GET /scan/mcp` | $0.10 | `:4006` | `scan_mcp_server` |
| `GET /enrich/tech-risk` | $0.05 | `:2046` | `enrich_tech_risk` |
| `GET /enrich/domain` | $0.01 | `:2249` | `enrich_domain` |
| `GET /dns/:domain` | $0.01 | `:1654` | — |
| `GET /whois/:domain` | $0.02 | `:1691` | — |
| `POST /mcp` (paid `tools/call`) | $0.005 | `:4634` | — |

### 7.2 Free

- **Previews** (8): `/crypto/prices/preview`, `/crypto/funding/preview`, `/defi/yields/preview`,
  `/pm/markets/preview` (all top-1 samples + `total_available` + an upsell note);
  `/chain/block-number/preview`, `/chain/gas-price/preview` (**identical to the paid route** —
  full live data); `/chain/token-security/preview` (**full real analysis**, but pinned to Base WETH
  `0x4200…0006`); `/scan/mcp/preview` (real scan of the caller's target, but returns only counts +
  severity histogram + score + verdict — withholds which tools and the evidence).
- **Discovery/meta:** `/`, `/health`, `/llms.txt`, `/openapi.json`, `/.well-known/x402`,
  `/.well-known/agent-card.json`, `/.well-known/mcp-registry-auth`, `/.well-known/402index-verify.txt`.
- **Human rail:** `/token-safety`, `POST /stripe/webhook`.
- **Internal:** `/internal/cdp-probe`, `/internal/cdp-settle-raw`.

The preview tier is the deliberate conversion mechanism: free previews are *real* (live upstream
calls, not canned fixtures) — the paywall buys breadth (`/chain/*` full set, arbitrary token,
itemized findings), not authenticity.

## 8. MCP surface — 22 tools

Server: `McpServer({name: "x402-data-api", version: "0.1.0"})` built by `createMcpHandler` at
`:4062`; `app.all("/mcp")` (`:4634`) clones and pre-parses the JSON body then hands the raw request
to `mcpHandler.fetch`.

**Free by protocol method:** `initialize`, `notifications/*`, and `tools/list` never hit the gate —
only `tools/call` does. That is what makes the server discoverable by any MCP client without a wallet.

**14 paid tools:** `crypto_prices`, `crypto_funding`, `defi_yields`, `pm_markets`,
`chain_block_number`, `chain_gas_price`, `chain_balance`, `chain_token_balance`, `chain_tx`,
`chain_wallet`, `chain_token_security`, `enrich_tech_risk`, `enrich_domain`, `scan_mcp_server`.

**8 free tools** (the `FREE_TOOLS` set at `:1616-1625`, which matches the registered preview tools
exactly): `crypto_prices_preview`, `crypto_funding_preview`, `defi_yields_preview`,
`pm_markets_preview`, `chain_block_number_preview`, `chain_gas_price_preview`,
`chain_token_security_preview`, `scan_mcp_preview`.

**The MCP surface is a strict subset of the HTTP surface.** `/chain/code`, `/chain/receipt`,
`/dns/:domain`, and `/whois/:domain` have paid HTTP routes but **no MCP tool**.

**Pricing asymmetry (by design, mis-described in the tool text — see §13).** MCP is gated at the
transport: *every* paid `tools/call` costs the flat `POST /mcp` price of **$0.005**, regardless of
which tool. So `enrich_domain` is $0.01 over HTTP but $0.005 over MCP, and `scan_mcp_server` is
$0.10 over HTTP but $0.005 over MCP — a 20× discount for reaching the same compute through MCP.

## 9. Data & compute internals

### 9.1 Base on-chain reads (`/chain/*`)

- **`baseRpc(method, params)` (`:62-86`)** — the only path to chain data. Iterates a fixed 4-provider
  list (`mainnet.base.org`, `base.llamarpc.com`, `base-rpc.publicnode.com`, `base.drpc.org`) and
  rotates on HTTP failure *or* a JSON-RPC `error` object, throwing only when all four fail. Fixed
  hosts, never a user-supplied URL → SSRF-safe by construction. `baseRpcProbe` (`:3476`) is the
  soft variant that returns `{result|error|unavailable}` instead of throwing, used where a revert is
  a *result* rather than a failure.
- **USD cross-pricing** — `getEthUsd()` (`:2897`) and `getTokenUsd(contract)` (`:2916`) with a 30s
  in-isolate TTL cache, so `/chain/balance`, `/chain/wallet`, `/chain/gas-price`, and
  `/chain/receipt` return `*_usd` fields. This is the stated differentiator over ETH-only RPC sellers.
- **`classifyCode()` (`:3256`)** — `is_contract`, code size, and **EIP-7702 delegated-EOA detection**
  (the `0xef0100` prefix + delegate address), surfaced on `/chain/code` and `/chain/wallet`.
- **`/chain/receipt`** decodes the full log set plus the Base **L1 fee breakdown**
  (`l1_fee_wei`, `l1_gas_price_wei`, `l1_gas_used`, `effective_gas_price_wei`) and converts to
  `l1_fee_usd` / `total_fee_usd`.
- **`getTokenMeta()` (`:3100`)** caches name/symbol/decimals per contract in an isolate-local `Map`.

### 9.2 Token security / honeypot detector (`/chain/token-security`, `:3332-3816`)

The most compute-heavy endpoint and the one with no thin-wrapper equivalent. `analyzeTokenSecurity`
fans out seven RPC workstreams in parallel and merges them into a 0-100 `risk_score` + verdict:

1. **Proxy detection (`detectProxy`, `:3371`)** — reads EIP-1967 implementation/admin slots, the
   EIP-1822 proxiable slot, **and** the legacy OpenZeppelin "zOS" `AdminUpgradeabilityProxy` slots
   (which is what Base USDC actually uses). Returns standard name + implementation + admin +
   `is_upgradeable`.
2. **Bytecode selector scan (`scanBytecodeSelectors`, `:3438`)** — greps the dispatcher for a
   catalog of 4-byte selectors mapped to six categories: `can_mint`, `can_burn`, `can_pause`,
   `has_blacklist`, `has_fee_setter`, `has_ownership`. **Critically, it scans the *implementation*
   bytecode when a proxy is detected**, not the thin forwarder — scanning the proxy would silently
   report "no capabilities" for every legitimate proxy token.
3. **Ownership (`getOwnerInfo`, `:3498`)** — `owner()` call, renouncement check, EOA-vs-contract
   classification of the owner.
4. **Honeypot simulation (`simulateTransferProbe`, `:3554`)** — the hard part. Derives the
   Solidity balance-mapping slot `keccak256(pad32(holder) . pad32(slot))` for slots 0-3, uses an
   `eth_call` **`stateDiff` state override** to grant a synthetic wallet `31337e18` of the token
   out-of-band, then attempts `transfer()` to a second synthetic wallet and observes revert vs
   success. Nothing is broadcast and no funds move. The result carries an explicit honest caveat in
   `method`: this detects wallet-to-wallet transfer blocks, **not** a DEX buy/sell round-trip, so
   there is no `buy_tax_pct`/`sell_tax_pct` and `transferable: true` is "no basic transfer-block
   found", not a sellability guarantee.
5. `PROBE_SLOT_RANGE = 4` is **tuned against the Cloudflare 50-subrequest-per-invocation cap** —
   the comment at `:3517-3525` records that a wider probe range plus a proxy's extra implementation
   fetch tripped that cap and broke *settlement* on an otherwise-successful analysis. This is the
   binding constraint on making this endpoint deeper.

### 9.3 MCP security scan (`/scan/mcp`, `:3818-4056`)

Fetches a target MCP server's tool list and statically analyzes every advertised tool's
name + description + schema — all attacker-controllable text the victim agent implicitly trusts.

- **Real handshake:** `initialize` → capture `Mcp-Session-Id` → `notifications/initialized` →
  `tools/list` with the session header, falling back to a bare stateless `tools/list`. The comment
  at `:3924-3931` records why: skipping the handshake made spec-compliant servers error, and the
  error was being swallowed into a false "0 tools, clean" verdict.
- **Five rule classes** (`analyzeMcpTool`, `:3837`), mapping to OWASP LLM01/LLM08:
  `tool-poisoning:hidden-instructions` (critical), `exfiltration-hint` (high),
  `dangerous-capability` (high), `cross-tool-shadowing` (medium), `invisible-unicode` (high) and
  `opaque-blob` (medium).
- **SSRF guard:** `isValidHostname()` (`:1775`) rejects anything with a scheme/path/port/credential/
  whitespace, rejects `localhost`, and requires a dotted hostname with an alpha TLD — so raw IPv4/IPv6
  targets fail by construction. This is the only route that fetches a fully caller-chosen origin.
- Runs entirely at the edge: pure `fetch` + text analysis, no subprocess, no third-party API key.

### 9.4 Domain enrichment (`/enrich/*`, `/dns`, `/whois`)

- `enrichTechRisk` (`:1986`) — header/body fingerprint → NVD keyword CVE search (`searchNvd`,
  `:1843`) → EPSS scores (`fetchEpss`, `:1881`) → CISA KEV membership (`isInKev`, `:1907`, with a
  module-level `kevCache` + timestamp) → weighted verdict.
- `enrichDomain` (`:2169`) — RDAP registrant/registrar, DoH records, crt.sh certificate-transparency
  subdomain enumeration (`searchCertificates`, `:2101`), tech fingerprint, and a domain-age verdict.
- `fingerprintDomain` (`:1786`) is the only function that fetches `https://<user-supplied-host>`, and
  it applies `isValidHostname()` as its first statement.
- `/dns/:domain` and `/whois/:domain` do **not** validate the hostname — they `encodeURIComponent`
  the value into a **fixed-host** DoH query param and a fixed-host RDAP path respectively, so the
  request destination is never caller-controlled. Bounded, but the asymmetry with `/enrich/*` is
  worth knowing.

### 9.5 Markets & DeFi

- `fetchPolymarketMarkets` (`:2358`) — Gamma `/markets` + `/events` (for category tags via
  `fetchMarketTags`, `:2333`), ranked by `volume24hr`, keyword-filterable; surfaces
  bestBid/bestAsk/spread, `clobTokenIds`, `conditionId`, liquidity, `oneDayPriceChange`.
- `fetchFundingRates` (`:2524`) — **three venues**: Hyperliquid (`metaAndAssetCtxs`, always present),
  OKX (`fetchOkxFunding`, `:2482`), dYdX (`fetchDydxFunding`, `:2512`). Computes the cross-venue
  **arb spread in bps**, cheapest-long/richest-short venue, premium/basis, annualized rates, and a
  `LONGS_PAY`/`SHORTS_PAY`/`NEUTRAL` signal. Venues that are unreachable or don't list a coin are
  omitted per-coin rather than failing the request.
- `fetchDefiYields` (`:2695`) — DefiLlama pools with the 1d/7d/30d APY trend, `il7d`, exposure,
  reward/underlying tokens, outlier flag, `mu`/`sigma`, DefiLlama's stability forecast
  (`predicted_probability`), and a derived `risk_adjusted_apy = apy/sigma` sort mode.
- `fetchTokenPrices` / `fetchTokenPriceChanges` (`:2824`, `:2805`) — DefiLlama coins API, CoinGecko
  ids validated against `COINGECKO_ID_RE`, capped at 25 ids.

**All upstreams are free and keyless**: DefiLlama, Hyperliquid, OKX, dYdX, Polymarket Gamma, Base
public RPCs, NVD, EPSS, CISA KEV, crt.sh, RDAP, Cloudflare DoH. The service holds **no third-party
API keys** — which is why it can be a single stateless Worker.

## 10. Discovery surfaces (served by the Worker)

| Surface | Route | Contents |
|---|---|---|
| x402 manifest | `/.well-known/x402` (`:287`) | Service overview + **18 resource entries**, each with x402 v2 `accepts` (scheme/network/USDC asset/`payTo`/amount/timeout), price, tags. `/dns/{domain}` + `/whois/{domain}` appear as path-templated resources. |
| A2A Agent Card | `/.well-known/agent-card.json` (`:354`) | RFC-8615 Agent-to-Agent discovery. **8 skills** grouping the routes, each naming its real route + price + preview + MCP tool. Payment flow described in prose since A2A has no payment-extension field yet. |
| OpenAPI 3.1 | `/openapi.json` (`:550`) | All 18 paid paths + `/`, with a documented `402` response per path. |
| llms.txt | `/llms.txt` (`:507`) | Plain-text agent-crawler catalog: how-to-pay, every paid endpoint with price, every free preview. |
| MCP Registry auth | `/.well-known/mcp-registry-auth` (`:280`) | `v=MCPv1; k=ed25519; p=…` — domain-namespace proof for `mcp-publisher`. |
| 402index proof | `/.well-known/402index-verify.txt` (`:274`) | Static ownership hash. |
| Landing page | `/` (`:107`) | Self-contained HTML, inline CSS, zero external resources — pitch, price table, curl sample, MCP client config JSON, discovery links. |

**Registry manifests in-repo:** `server.json` (MCP Registry, `io.github.rezearcher/tech-risk`
v1.2.0, streamable-http remote) and `glama.json` (Glama listing).

## 11. Companion component — `mcp-client/`

A separate npm package, `x402-data-api-mcp` v0.1.0, that runs **on the installing agent's machine**
and speaks MCP over **stdio**, proxying to the deployed Worker's `/mcp`. It adds no data surface —
it is a transport + payment shim so stdio-only clients (Claude Desktop, Cursor) can reach the 22
remote tools.

- **Payment path (`src/server.ts:29-56`):** wallet key comes from `X402_WALLET_PRIVATE_KEY` — the
  *installer's* key, read from their env. No key or wallet file for this client exists in the repo.
  When set, it dynamically imports `wrapFetchWithPayment` / `x402Client` / `registerExactEvmScheme` /
  `privateKeyToAccount` and replaces the module-local fetch, so a 402 is signed and retried
  transparently. Init failure is **non-fatal** — logs to stderr and falls back to plain fetch
  (free tools only).
- **Scope is narrower than its own docstring:** only `ListToolsRequestSchema` (`:117`) and
  `CallToolRequestSchema` (`:131`) are registered, and capabilities declare `tools` only.
  `initialize` is answered **locally by the MCP SDK**, not proxied — the header comment claiming it
  proxies `initialize` overstates it. No resources, no prompts, no notification pass-through.
- **Response handling (`:87-113`):** tries JSON, else scans for SSE `data: ` lines and takes the last
  valid one, else synthesizes a JSON-RPC error carrying the HTTP status.
- `dist/` is **committed** (`.gitignore` only ignores `node_modules/`), so the `bin` target ships
  even without a build. `test-mcp-client.mjs` spawns `dist/server.js`, asserts all 22 tool names, and
  calls 4 free previews against live production.

## 12. Companion component — `apify-actor/`

Python Apify Actor `grey-ridge-base-onchain` v0.1.0 (`.actor/actor.json`, `Dockerfile`,
`input_schema.json`, `src/main.py`, 410 lines). Queries Base on-chain data for Apify's marketplace
at $0.001/run via Apify's own x402 integration.

Architecturally it is a **free-tier consumer of this API, not a paid one**: gas price and block
number come from `/chain/gas-price/preview` and `/chain/block-number/preview`, ETH/USD from
`/crypto/prices/preview`, while ETH and ERC-20 balances are read **directly** from the same four
public Base RPCs the Worker uses (`_rpc_call`, `_eth_call`). It therefore carries no wallet, no
secret, and generates no x402 revenue — it is a distribution surface. Note `_fetch_eth_usd`
(`:224-242`) knowingly parses the preview's fixed BTC sample shape; the comment records the caveat.

## 13. Ops tooling (human-run Node/Python scripts)

| Script | Purpose |
|---|---|
| `seed_batch_cdp.js` (237) | Batch CDP Bazaar seeder. Iterates a **hardcoded 4-route manifest** (`/pm/markets`, `/chain/token-security`, `/chain/gas-price`, `/chain/block-number`); per route: live 402 → sign → `POST /internal/cdp-settle-raw`. Persists a **12h cooldown** to `.cdp_seed_cooldown.json`, written only on the success path. **Takes no arguments** — no `process.argv` handling exists. |
| `seed_endpoint.js` (263) | Single-route seeder, one **positional** arg: `node seed_endpoint.js /crypto/funding`. Carries a 13-route metadata table incl. `/chain/token-security` and the full Base-RPC set. Price/asset/payTo are read from the **live** 402, so it is price-agnostic. |
| `seed_raw_cdp.js` (118) | The original single-purpose `/pm/markets` CDP seeder that the two above generalize. |
| `seed_normal_xpay.js` (132) / `test_payment_flow.js` (132) | **Near-duplicates** — identical except the wallet path (`buyer-wallet.json` vs `~/.hermes/secrets/base-wallet.json`) and the target URL (`/pm/markets` vs `/enrich/tech-risk`). Real paid xpay round-trips. |
| `smoke.js` (55) | Paid smoke test against any path: `node smoke.js "/crypto/prices?coins=bitcoin"` — pays the advertised price and prints the body. The end-to-end paid→data proof. |
| `fund_buyer.js` (49) | One-time: generate a throwaway buyer wallet and fund it with 0.03 USDC from the main wallet. Needed because CDP rejects self-sends, so seeds require `from != payTo`. |
| `register_x402scan.js` (57) | SIWX (wallet-signature, not payment) registration with x402scan.com — `register-origin` by default, or a single resource URL as `argv[2]`. |
| `scripts/verify_revenue_ledger.py` (601) | Two modes. Normal: reads `~/.hermes/data/<play>-revenue/ledger.jsonl`, resolves each row's USDC `Transfer` `from` via `eth_getTransactionReceipt`, classifies self-traffic vs external, writes `ledger_verified_summary.json`. `--probe-check` (`:586`→`run_probe_check`, `:507`): scores each "external" payer on three bot heuristics — total nonce, identical-method bursts within 120s, unsolicited farm-token receipts — writing `probe_check_summary.json` **without mutating** normal-mode files. |
| `.metrics/compute_revenue_usd.py` (91) | Reads both sidecars, sums only `external` rows whose payer is **not** probe-flagged, writes the same value to `.metrics/revenue_usd` **and** `.metrics/revenue_usd_corrected`. Hard-fails if either sidecar is missing. Both files currently read **`0.0`**. |
| `scripts/auto-merge.sh` (86) | `kanban_task_completed` hook: merges `wt/<task_id>` into `main`, pushes, deletes the branch. **Fail-OPEN by construction** — every failure path is `exit 0`, a failed merge calls `git merge --abort` and writes a diagnostic to `~/.hermes/data/x402-data-api-health/auto_merge_failures/<task_id>.log`. |
| `scripts/deploy.sh` (39) | Resolves `CF_WORKERS_TOKEN` (Workers:Write scope — **not** `CF_API_TOKEN`) then `npx wrangler deploy`. |

**Wallets:** `buyer-wallet.json` (throwaway buyer, gitignored) and `~/.hermes/secrets/base-wallet.json`
(the `payTo`/provider identity, outside the repo). No private key is in the tracked tree.

## 14. Doc-drift corrections

Statements elsewhere that this pass's code read disproves. Corrected here; the referenced files are
**not** edited by this doc.

- **`glama.json` says `"tools": 19`.** The server registers and serves **22** (live-verified §16).
  Stale by three.
- **MCP tool descriptions overstate price 10× on three tools.** `enrich_tech_risk` (`:4072`),
  `enrich_domain` (`:4095`), and `scan_mcp_server` (`:4117`) advertise *"Cost: $0.05 USDC per call"*.
  The actual gate is the flat `POST /mcp` price of **$0.005** (`makeRoutes`, `:742`). The other 11
  paid tools correctly say $0.005. `enrich_domain`'s text additionally claims MCP is gated *above*
  its HTTP price, which is backwards — MCP is the cheaper rail for it.
- **Two code comments repeat the same 10× error:** `:1598` ("only tools/call is x402-gated ($0.05)")
  and `:4059` ("expose enrich_tech_risk as an MCP tool ($0.05 paid via x402)"). The `scan_mcp_preview`
  upsell string (`:4030`) also quotes "$0.05 USDC" for the paid MCP tool.
- **`:4059`'s section header is stale in a second way** — it says the MCP endpoint exposes
  `enrich_tech_risk`; it exposes 22 tools.
- **`.well-known/x402` resource count is settled: 18.** Prior revisions of this file carried a
  "count disputed — 16 vs 18" note. Live probe returns 18 (§16). The dispute is closed.
- **Seeder CLI flags that never existed.** `docs/AGENTIC_MARKET_ENRICHMENT.md` advertised
  `--workers-url` / `--dry-run` / `--route` on `seed_batch_cdp.js`; the file contains zero
  `process.argv` references. Correct invocations: `node seed_batch_cdp.js` (no args) and
  `node seed_endpoint.js <route>`. (Corrected in that file 2026-07-29.)
- **`PLAN.md` status section is stale** — it describes the MCP surface as the two `/enrich/*`
  endpoints. Actual: 22 MCP tools / 18 paid HTTP routes.
- **`seed_cdp_pm.js` is gitignored**, so distribution inventories that list it as a repo artifact are
  wrong about the public repo.
- **Historically corrected and still correct:** README's "19 tools" and DISTRIBUTION_READY's
  "11 tools" / "15 paid endpoints" were fixed 2026-07-18; funding venues are Hyperliquid **+ OKX +
  dYdX** (README said two); `LICENSE` exists and `package.json`/`glama.json` agree on MIT (an earlier
  "no LICENSE file" gap was itself the doc lie).

## 15. Gaps — claimed, planned, or implied but not shipped

**Revenue (the headline).**
- **Organic revenue is $0.00**, confirmed across three independent forensic passes:
  blind-$0 → $0.395 (ledger integration) → $0.015 (after excluding self-traffic: 23/26 rows, 96.25%,
  were the buyer wallet `0xC4852c…` and `payTo` `0x5765ae…`) → **$0.00** (after the sole remaining
  "external" payer `0x7e571e…` scored `probe_score=1.000` on all three bot heuristics — nonce 3,176,
  15× identical `giveFeedback()` calls in 120s, 3 unsolicited farm-bait tokens). No human or
  task-driven agent has ever knowingly paid. `.metrics/revenue_usd*` both read `0.0`.

**Atoms that require Rez's account/identity** (cannot be automated):
- **npm publish** — `mcp-client/` is built, committed, and locally runnable but **unpublished**, so
  every `npx x402-data-api-mcp` instruction in its README and in the MCP-directory submissions fails
  for an outside installer. Only the in-repo `node dist/server.js` path works.
- **Stripe activation** — `STRIPE_API_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` are unset,
  and no Checkout Session route or payment link exists, so `/token-safety`'s Subscribe button is a
  placeholder. The KV namespace is now wired (`90cadd1`), so this is the only remaining blocker on
  the human rail.
- **RapidAPI seller account + Stripe payout** for the dual-rail plan.
- **Apify deploy** — the Actor is built and committed but not verified live on Apify's platform.
- **Glama listing** — needs a passive crawl of the now-public repo or a manual browser submit.

**Engineering gaps:**
- **No CI/CD.** There is no `.github/workflows/`. `tsc --noEmit`, the MCP client build, and the test
  harness run only when someone runs them by hand. Both publish (`git push`) and deploy
  (`wrangler deploy`) are manual.
- **No automated test suite.** `smoke.js` and `mcp-client/test-mcp-client.mjs` are manual scripts
  that spend real USDC / hit live production; there is no unit or integration test runner.
- **The mcp-client paid path has never been demonstrated** — all 5 harness tests exercise free
  previews. The x402 wiring is code-reviewed, not round-trip-proven.
- **Two independent version identities:** npm `0.1.0` vs `server.json` `1.2.0` vs MCP server
  `0.1.0` vs Agent Card `1.0.0`. Nothing syncs them, and the 22-tool list is hardcoded in
  `mcp-client/README.md` + the test harness, so it will drift silently.
- **`mcp-client` is invisible on the repo's own discovery surfaces** — root `README.md`,
  `server.json`, and `glama.json` contain zero references to it.
- **`mcp-client/README.md` step 1 points at a non-existent `.env.example`.** Inert (both vars are
  read straight from `process.env`), not blocking.
- **API-key credit decrement is non-atomic** and the Stripe signature compare is not constant-time
  (§6).
- **Agentic.Market enrichment is still not fixed** — the `t_1a11024d` card's headline goal. What
  shipped is CDP Bazaar seeding, which sits *upstream* of Agentic.Market's own enrichment pipeline.
  There is no code anywhere that sets `description`/`category` on that service record.
- **`.worktrees/` accumulates stale per-card checkouts** — `auto-merge.sh` deletes *branches*, not
  worktree directories.

**Next moat builds (not started):** indexed event history (public RPCs cap `eth_getLogs` at ~10
blocks → needs a D1/KV indexer that respects the ~50-subrequest cap); cross-DEX best-quote /
price-impact on Base; an Aave/Moonwell near-liquidation monitor.

## 16. Verification evidence

Everything in this document was verified on **2026-07-29** against commit `90cadd1`.

**Static (this tree):**
- `wc -l src/index.ts` → **4,652** (prior revisions of this doc said "~4,200").
- `npx tsc --noEmit` → **exit 0, clean.**
- 19 entries in `makeRoutes()` = 18 paid `GET` + `POST /mcp`; 22 `server.registerTool(` calls;
  8 entries in `FREE_TOOLS`, matching the 8 registered `*_preview` tools exactly.
- `ls .github` → **does not exist** (no CI).
- `git ls-files seed_cdp_pm.js buyer-wallet.json` → 0 (both untracked).

**Live (`https://x402-data-api.sigrunner.workers.dev`):**

| Probe | Result |
|---|---|
| `GET /health` | `200` |
| `GET /.well-known/x402` | `200`, **`resources` length = 18**, `mcp_endpoint` present |
| `GET /.well-known/agent-card.json` | `200` |
| `GET /token-safety` | `200` (Stripe-rail landing page is deployed) |
| `GET /chain/gas-price` (no payment) | **`402`** — gate live |
| `POST /mcp` `tools/list` | **22 tools**, names identical to the source registration list |

The deployed Worker is therefore **in sync with `main`** on tool count, resource count, and gating
behavior. Not probed: any paid settlement round-trip (costs real USDC), and the Stripe webhook
(no secrets set).

---

## Appendix A — verification history

Condensed record of prior audit passes, kept so their verdicts are not re-litigated. Full narrative
lives in the referenced docs and in git history.

| Date | Pass | Verdict |
|---|---|---|
| 2026-07-19 | Public source repo (`t_4fea70bb`) | **PASS.** Repo public, `private == false`, created `2026-07-19T18:07:21Z`. All 7 gitleaks/trufflehog hits were the canonical Circle USDC contract `0x833589fC…` — false positives, no key material pushed. |
| 2026-07-18/24 | Five 2026-07-17/18 "completed" cards | 3 rescued + verified (`apify-actor/` at `f9c7b37`; `docs/MCP_SUBMISSIONS_LOG.md` + `docs/DISCOVERY_LISTING_STATUS.md` at `ce8c048`); 2 superseded by re-dos (`t_d6a7f9c9` → `docs/DEMAND_RESEARCH.md`, `t_de151427` → `docs/DISTRIBUTION_STATUS.md`). External decay noted: `sol-dispenser/gold-402` and `sol-dispenser/awesome-x402` now 404 — do not count them as durable channels. |
| 2026-07-18/19 | Dependabot cards `t_ed83c170` (rustls), `t_c70a762b` (tokio) | **Misdirected / no-op.** This is a TypeScript Worker — no `Cargo.toml`, no `.rs`, zero occurrences of either crate. Never record them as shipped here. |
| 2026-07-20 | Discovery completeness | `/dns/{domain}` + `/whois/{domain}` added to `.well-known/x402` + `openapi.json` (deploy `2887ef85`). Re-confirmed live 2026-07-29: 18 resources. |
| 2026-07-23/24 | Revenue forensics (`t_efa5b713`, `t_5c08554f`, `t_913952c8`, `t_70fcb2ca`) | Organic revenue walked $0.395 → $0.015 → **$0.00**. Artifacts: `scripts/verify_revenue_ledger.py`, `docs/REVENUE_LEDGER_AUDIT.md`, `.metrics/compute_revenue_usd.py`. **Open inconsistency inside `REVENUE_LEDGER_AUDIT.md`:** the summary table says 26 ledger rows (`:11`), the addendum says 221 (`:75`). The $ figures are consistent with 26; re-run the verifier before quoting either externally. **Unverified out-of-sandbox:** that Hermes' `milestone.json` actually re-points to `revenue_usd_corrected` — the producer writes both filenames so they can never disagree, but the milestone sensor's own built-in branch was never confirmed bypassed. |
| 2026-07-27 | Worktree-bypass pattern | Twice in one pass a coder committed straight to `main` instead of its assigned `wt/<id>` worktree (`t_aef95830` → `ae27bbe`, `t_819dd337` → `10fdeb3`), silently defeating the isolation/auto-merge net and false-FAILing worktree-only acceptance checks. **Rule:** an acceptance sweep must check live `main` before trusting a worktree-only FAIL. |
| 2026-07-29 | KV binding | `[[kv_namespaces]] binding = "API_KEYS"` wired in `90cadd1`, closing the recurring token-binding gap. Stripe secrets still unset. |
| 2026-07-29 | **This rewrite** | Full source scan + live probe. See §16. |

---

*Related reading: `docs/FIRST_DOLLAR_PLAYBOOK.md` (thesis + outreach), `docs/DISTRIBUTION_STATUS.md`
and `docs/DISCOVERY_LISTING_STATUS.md` (channel state), `docs/QUALITY_UPGRADE_PLAN.md` (endpoint
quality), `docs/MARKET_ANALYSIS_2026-07-16.md` (market thesis), `docs/REVENUE_LEDGER_AUDIT.md`
(revenue forensics), `docs/A2A_DISCOVERY.md`, `docs/TOKEN_SAFETY_STRIPE_PROBE.md`. This file
supersedes their code-level claims.*
