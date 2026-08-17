# Audit — x402-data-api (Q3 onboarding: secrets / sell-path / risk-guards)

**Audit date:** 2026-08-16
**Repo:** `/home/rez/projects/x402-data-api` @ HEAD `6e4a6f61d5505936dca67481d6e6f9e12aa52b3d`
**Audit scope:** Q3 onboarding — credential/wallet-key handling, paid-settlement (sell) path, financial risk guards; docs/ + ARCHITECTURE.md claims cross-checked against code at HEAD.
**Method:** Read-only code review (src/index.ts 5,124 lines, src/facilitator.ts, src/examples.ts, wrangler.toml, .gitignore, docs/, ARCHITECTURE.md), git history/ignore verification, one local in-process Hono dispatch-order test (no network, no live payments).
**Guardrails honored:** no code/config/wallet modification; no wallet private keys or live tokens read or printed (ignore/track status verified via git only); no outbound requests against live services (the only fetch() calls made were local in-process Hono dispatch, which does not leave the sandbox).
**Verdict:** **CONDITIONAL PASS.** Secrets handling and the sell path are sound (F7/F8), but three findings need action before the Stripe rail activates or before the CDP seed tooling is considered retired: F1 (ungated internal CDP endpoints in production), F2 (webhook replay → credit farming), F4 (paid customers never receive their API key). F3 is a real billing bug on the dormant rail. F5/F6 are hardening.

---

## Declared financial surface

| Surface | Detail | Status |
|---|---|---|
| Agent rail (x402) | 18 paid GET routes + POST /mcp; Base mainnet USDC; prices $0.001–$0.10 | Live |
| Facilitator (sell path) | xpay `https://facilitator.xpay.sh` (production), CDP `api.cdp.coinbase.com/platform/v2/x402` (flag-gated, seed-only) | Verified |
| PAY_TO | `0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10` (wrangler.toml `[vars]`, public address) | Verified |
| Human rail (Stripe) | `POST /stripe/create-checkout-session`, `POST /stripe/webhook`, KV `API_KEYS`, CreditLedger DO — Pro $9.99/mo, 100 credits | Dormant (secrets unset per ARCHITECTURE §6/§14; not verifiable read-only) |
| Wallet keys | `buyer-wallet.json` — gitignored, never committed (git log --all: no hits) | Verified |
| Env files | `.dev.vars`, `.env`, `.mcp-registry-key` — all gitignored; only `.dev.vars.example` tracked (empty values) | Verified |

## Verification checklist

1. **buyer-wallet.json / secret files:** `git ls-files` → none of `buyer-wallet.json`, `.dev.vars`, `.env`, `.mcp-registry-key` tracked. `git log --all` for `buyer-wallet.json` → no commits ever. No PEM/private-key material in history (only a `sk_live_...` placeholder literal inside `docs/TOKEN_SAFETY_STRIPE_PROBE.md` — documentation text, not a real key). PASS.
2. **Sell path (src/facilitator.ts):** `createCdpFacilitator` mints a per-request CDP JWT from Worker secrets (`@coinbase/cdp-sdk/auth` `generateJwt`, requestHost `api.cdp.coinbase.com`, paths `/platform/v2/x402/{verify,settle,supported}`) and returns `Authorization: Bearer <jwt>` (literal verified on disk — no mangled header). Wired via `selectResourceServer` only when `FACILITATOR_MODE === "cdp"` AND both CDP secrets present; production default is xpay (non-custodial HTTPFacilitatorClient). Server never holds private keys; settlement is buyer-signed EIP-3009 relayed by the facilitator. PASS — honest sell path.
3. **Risk guards:** no spend caps, payout caps, or per-key rate limits exist anywhere (grep `spend|payout|cap` → only comments/docstrings). For the x402 rail this is by design (non-custodial, buyer pays per call). The only financial guardrails: per-call prices + the 100-credit monthly bucket on the Stripe rail. See F7.
4. **Docs claims vs code:**
   - ARCHITECTURE.md route inventory (18 paid GET + POST /mcp) matches `makeRoutes` and the live `.well-known/x402` manifest; 22 MCP tools matches 22 `registerTool` calls. PASS.
   - REVENUE_LEDGER_AUDIT.md ($0.005 true external revenue, 93.9% self-traffic contamination) matches `.metrics/revenue_usd` on disk (= 0.005) and is honestly carried in ARCHITECTURE §15. PASS.
   - TOKEN_SAFETY_STRIPE_PROBE.md's `?api_key=` design matches the gate; its webhook-flow description matches code *including* the missing key-delivery gap (F4) — the doc's own success signal ("paying subscriber") is unreachable until F4 is fixed.
   - ARCHITECTURE §5 documents `/internal/cdp-settle-raw` as a one-time seed tool — confirming F1's status as leftover staging surface, not a documented permanent feature.

## FINDINGS

### F1 — HIGH — Ungated temporary CDP endpoints in production (`/internal/cdp-probe`, `/internal/cdp-settle-raw`)
- **Location:** src/index.ts:393 (`GET /internal/cdp-probe`), :427 (`POST /internal/cdp-settle-raw`), gate at :2018.
- **Evidence:** Both routes are registered **before** the `app.use` payment gate. Hono applies middleware only to routes registered after it — verified empirically with an in-process test (`/internal/probe => 200 probe-leaked` when the gate middleware is registered after the route). No other `app.use` exists before :393. With CDP secrets set (wrangler.toml comments say CDP exists precisely for the Bazaar seed via these endpoints), they are live in production.
- **Impact:** Unauthenticated callers can (a) trigger CDP JWT minting from production secrets and read `jwt_len` + the first 400 chars of the CDP facilitator's response (confirms secret presence, leaks CDP response internals, burns API quota); (b) POST arbitrary `{paymentPayload, paymentRequirements}` and have the worker relay them to the CDP facilitator's `/verify` then `/settle` under our API key — an open settlement/credential oracle. Comments label both "(temporary)" seed tools.
- **Fix:** Delete both routes (the Bazaar catalog seed is a one-time action, already performed) or, if retention is genuinely needed, gate them behind the shared `RAPIDAPI_PROXY_SECRET`-style header and remove from the public surface.

### F2 — MEDIUM — Stripe webhook: no replay/dedup guards → credit farming when activated
- **Location:** src/index.ts:1915–1990.
- **Evidence:** Signature verification is correct (HMAC-SHA256 over `t.body`, constant-time compare). But: (a) no timestamp-freshness window (`t` unchecked — a captured signed request replays forever); (b) no idempotency on `session_id` — every delivery of the same event mints a fresh 100-credit key (Stripe retries and any replay both mint); (c) no `session.payment_status === "paid"` check — subscription sessions can complete with an unpaid first invoice on async payment methods.
- **Impact:** Dormant today (STRIPE secrets unset per ARCHITECTURE §6; activation state of prod secrets not verifiable read-only). On activation: one captured/replayed `checkout.session.completed` event yields unlimited free 100-credit keys → free access to every paid endpoint.
- **Fix:** Record processed `session_id`s in KV and reject duplicates; require `session.payment_status === "paid"`; reject `|now − t| > 300s`.

### F3 — MEDIUM — Last-credit off-by-one: final credit consumed but request denied (double-billing)
- **Location:** src/index.ts:2061–2065 with `deductCredit` at :1713–1722.
- **Evidence:** `deductCredit` returns the post-decrement balance, which is `0` both when a key is exhausted (nothing deducted) and when the *last* credit was successfully spent. The gate checks `remaining > 0` → a key with balance 1 deducts to 0 and falls through to the x402 gate: the user loses their final credit AND is charged again via x402. The doc comment at :1702–1705 acknowledges the ambiguous 0 but the middleware does not disambiguate. Every Pro subscriber's 100th monthly check is denied and double-billed.
- **Impact:** Billing-accuracy bug; user-facing loss on the human rail (dormant now, but the bug ships with activation).
- **Fix:** Return a discriminated result (`{deducted: boolean, remaining: number}`) and authorize when `deducted === true`, or add a sentinel (e.g. return `-1` on insufficient funds).

### F4 — MEDIUM — Paying Stripe customer never receives their API key (rail is undeliverable)
- **Location:** src/index.ts:1878 (success_url `/?session_id={CHECKOUT_SESSION_ID}`), :1969–1985 (key minted to KV), root landing-page handler (~:200–390) ignores `session_id`.
- **Evidence:** grep of `session_id` across the file: schema (:1671), success_url (:1878), webhook (:1960/:1972) — no lookup/redemption path anywhere. The webhook's response goes to Stripe, not the customer; the success redirect lands on the homepage with no key display and no `/api-key?session_id=` endpoint. A buyer pays $9.99 and never learns their key.
- **Impact:** Undeliverable paid product → immediate refunds/churn on activation; the probe's own success metric is unreachable. This is the human-rail equivalent of a broken sell path.
- **Fix:** Add `GET /api-key?session_id=...` (validate + one-time redemption) or display the key on a success page reached via a signed redirect token.

### F5 — LOW — API keys travel in URL query strings
- **Location:** src/index.ts:2045 (`c.req.query("api_key")`).
- **Evidence:** Keys (`sk_…`) are passed as `?api_key=` → Cloudflare access logs, browser history, referrer chains, and proxy logs. The docs' own architecture diagram uses this form.
- **Fix:** Accept `Authorization: Bearer` / `X-API-Key` header; keep the query form only for the browser demo if needed, with log redaction.

### F6 — LOW — `isValidHostname` permits internal-looking TLDs (residual SSRF surface)
- **Location:** src/index.ts:2250–2256 (used by `fingerprintDomain` :2261 and `scanMcpServer` :4397).
- **Evidence:** The regex requires a dotted name with an alpha TLD ≥2 chars but does not block `.local`, `.internal`, `.corp`, `.lan`, `.home`. In practice Cloudflare Workers' network isolation makes metadata (169.254.169.254) and private ranges unreachable from the edge, so exploitability is minimal — but a DNS-rebinding target resolving to internal space is not filtered at fetch time.
- **Fix:** Add a denylist of internal TLDs and/or resolve-then-validate (reject private/reserved IPs after lookup).

### F7 — INFO — No spend/payout caps exist (by design for the x402 rail)
- **Location:** whole repo; grep `spend|payout|cap` → only comments/docstrings.
- **Evidence:** The server is non-custodial: x402 settlement is a buyer-signed EIP-3009 relayed by the facilitator; PAY_TO is a public address; no withdrawal/payout function exists to cap. Per-call prices + the 100-credit monthly bucket are the only guardrails.
- **Note:** If a hot wallet is ever added (refunds, withdrawals, batch settlement), spend/payout caps become mandatory — flag for the next audit pass.

### F8 — INFO — Sell-path honesty: PASS
- **Location:** src/facilitator.ts (whole file), src/index.ts:1000–1035.
- **Evidence:** CDP JWT minted per-request from Worker secrets with correct `Bearer` header (literal verified); `HTTPFacilitatorClient` pointed at the CDP x402 endpoint; only selected when `FACILITATOR_MODE === "cdp"` + both secrets present; production default xpay (non-custodial). No private key material tracked, committed, or printed; `buyer-wallet.json` never in history. No server-side custody of funds anywhere on the sell path.

---

## Verdict

**CONDITIONAL PASS.** The declared secrets surface is clean (F8), docs claims are honest and match code, and the sell path is non-custodial. The conditional items are the three medium/high findings that become live-money issues the moment the Stripe rail activates (F2, F3, F4) and the unauthenticated internal CDP endpoints (F1) that are live today. Recommend: delete or gate F1 immediately; fix F2/F3/F4 before setting STRIPE secrets; adopt F5/F6 opportunistically.

## Evidence appendix

- Hono dispatch-order test (in-process, no network): route registered before global middleware → middleware does NOT run → `/internal/probe => 200 probe-leaked`; route after middleware → gated. Reproduces at node_modules/hono/dist/hono-base.js `#dispatch` (router.match handler order).
- `git ls-files | grep -E 'buyer-wallet|\.env|\.dev\.vars|mcp-registry'` → empty.
- `git log --all --oneline -- buyer-wallet.json` → empty.
- `.metrics/revenue_usd` → `0.005` (matches REVENUE_LEDGER_AUDIT.md).
- `grep -c 'server.registerTool' src/index.ts` → 22 (matches ARCHITECTURE §8).
- Paid-route inventory (grep `app.(get|post|all)`): 18 paid GET routes + POST /mcp + POST /scan/mcp-equivalent, matching ARCHITECTURE §7.1 and the `.well-known/x402` manifest.
