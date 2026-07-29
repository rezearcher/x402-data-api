# ARCHITECTURE — x402-data-api

**Source of truth for what is actually shipped.** Verified against `src/index.ts` on
2026-07-21; dependency/Dependabot cards re-checked against the manifests on 2026-07-21 (see §6a);
the public source-repo publication (card `t_4fea70bb`) was independently re-verified 2026-07-21 (see §5a);
**doc-sync pass 2026-07-28** read `mcp-client/` end-to-end (see §11);
**doc-sync pass 2026-07-25** re-read `.metrics/compute_revenue_usd.py`, `scripts/verify_revenue_ledger.py`,
`scripts/auto-merge.sh`, `docs/REVENUE_LEDGER_AUDIT.md`, `.gitignore`, `LICENSE`, `package.json` (see §9);
Where a claim in another doc conflicts with the code, the code wins and the
conflict is recorded in [Doc-drift corrections](#doc-drift-corrections). Prices, counts,
and route lists below were read out of the code, not copied from prose.

---

## 1. What it is

*(As of 2026-07-27 the repo holds **two** shipped components: the Worker below, and
`mcp-client/` — a local stdio MCP client that proxies to it, §11.)*

A single [Cloudflare Worker](./src/index.ts) (~4,200 lines) that serves pay-per-call
crypto / DeFi / prediction-market / Base on-chain data **and** MCP-security scanning over
the [x402 payment protocol](https://x402.org) on **Base mainnet** (`eip155:8453`, USDC).
No account / API key / subscription: an agent pays inline in USDC and gets the data back in
the same request. Every data endpoint exposes a **free preview**.

- **Deployed:** `https://x402-data-api.sigrunner.workers.dev`
- **Source:** `https://github.com/rezearcher/x402-data-api` — **public** since 2026-07-19 (§5a)
- **MCP endpoint (streamable-http):** `/mcp`
- **Runtime:** Cloudflare Workers, `nodejs_compat`, `compatibility_date = 2025-06-01` (`wrangler.toml`)
- **Framework:** Hono 4 + `@x402/hono` `paymentMiddleware` / `x402ResourceServer`
- **Settlement:** **xpay** non-custodial facilitator (`FACILITATOR_URL=https://facilitator.xpay.sh`,
  `FACILITATOR_MODE=xpay`). No Coinbase/CDP account is required to settle. `PAY_TO` is a Base
  wallet Rez controls (`0x5765…`, overridable via `wrangler secret put PAY_TO`).

## 2. Request path & payment gate

1. Global middleware builds the paid-route map (`makeRoutes(PAY_TO)`) once and caches it
   (`cachedMiddleware`), then delegates to `@x402/hono` `paymentMiddleware`.
2. A gated route with no valid payment → **HTTP 402** with an x402 v2 challenge
   (network `eip155:8453`, asset USDC). An x402-capable client signs an EIP-3009
   authorization and retries; the middleware verifies + settles via xpay.
3. **CDP is used only** for the one-time Bazaar catalog seed via `/internal/cdp-settle-raw`
   (which bypasses the `@x402` resource server); switching `FACILITATOR_MODE` to `cdp` would
   break settlement on declared routes on Workers (ajv `new Function` is blocked) — see the
   note in `wrangler.toml`.
4. All upstreams are **free/keyless** public APIs (DefiLlama, Hyperliquid, OKX, dYdX,
   Polymarket Gamma, Base JSON-RPC with multi-provider failover, NVD/EPSS/CISA-KEV,
   crt.sh/RDAP/DoH). Inputs are validated and SSRF-guarded; the only user-supplied fetch
   targets are the explicitly-scoped `/scan/mcp`, `/dns`, `/whois`, and enrichment routes.

## 3. Paid endpoint inventory (code-verified)

**18 paid `GET` endpoints** are registered in `makeRoutes()` (plus `POST /mcp`). Prices are
the actual `makeRoutes` values.

| Endpoint | Price | In README? | In `.well-known/x402`? |
|---|---|:--:|:--:|
| `GET /crypto/prices` | $0.001 | ✓ | ✓ |
| `GET /crypto/funding` | $0.001 | ✓ | ✓ |
| `GET /defi/yields` | $0.001 | ✓ | ✓ |
| `GET /pm/markets` | $0.005 | ✓ | ✓ |
| `GET /chain/block-number` | $0.001 | ✓ | ✓ |
| `GET /chain/gas-price` | $0.001 | ✓ | ✓ |
| `GET /chain/balance` | $0.001 | ✓ | ✓ |
| `GET /chain/token-balance` | $0.001 | ✓ | ✓ |
| `GET /chain/tx` | $0.001 | ✓ | ✓ |
| `GET /chain/receipt` | $0.001 | ✓ | ✓ |
| `GET /chain/code` | $0.001 | ✓ | ✓ |
| `GET /chain/wallet` | $0.003 | ✓ | ✓ |
| `GET /chain/token-security` | $0.02 | ✓ | ✓ |
| `GET /scan/mcp` | $0.10 | ✓ | ✓ |
| `GET /enrich/tech-risk` | $0.05 | ✓ | ✓ |
| `GET /enrich/domain` | $0.01 | ✓ | ✓ |
| `GET /dns/:domain` | $0.01 | ✓ (fixed 2026-07-20) | ✓ (fixed 2026-07-20) |
| `GET /whois/:domain` | $0.02 | ✓ (fixed 2026-07-20) | ✓ (fixed 2026-07-20) |

**Fixed 2026-07-20** (Prospector run): `.well-known/x402` and `openapi.json` now advertise all
**18** paid routes, incl. `/dns/{domain}` and `/whois/{domain}` as path-templated resources.
Deployed (version `2887ef85`) and curl-verified live: both show up in the resource/paths list
and still 402-gate correctly. `token-security`'s "✗ (missing)" row above was already stale
before this pass — it was present in `.well-known/x402` in the prior deploy too; corrected here.
The remaining gap is `/mcp` itself (the MCP JSON-RPC endpoint) not being a `.well-known/x402`
resource entry, which is expected — it's a protocol endpoint, not an HTTP GET resource.

**Free routes (ungated):** `/`, `/health`, `/.well-known/x402`, `/.well-known/mcp-registry-auth`,
`/.well-known/402index-verify.txt`, `/openapi.json`, `/llms.txt`, and the previews:
`/crypto/prices/preview`, `/crypto/funding/preview`, `/defi/yields/preview`,
`/pm/markets/preview`, `/chain/block-number/preview`, `/chain/gas-price/preview`,
`/chain/token-security/preview`, `/scan/mcp/preview`. Internal: `/internal/cdp-probe`,
`/internal/cdp-settle-raw` (Bazaar seed only).

**Differentiators actually in the code** (not just claims): cross-venue funding with
**Hyperliquid + OKX + dYdX** and arb spread; DeFi yields with 1d/7d/30d APY trend + IL risk +
DefiLlama stability forecast; EIP-7702 delegated-EOA detection on `/chain/code` and
`/chain/wallet`; USD cross-pricing on chain reads; and `/chain/token-security` — a real
`eth_call` state-override honeypot simulation + proxy/bytecode selector scan (own compute,
not a GoPlus wrapper).

## 4. MCP server — **22 tools** (code-verified)

`initialize`, `notifications`, and `tools/list` are **free** (discovery); paid `tools/call`
returns an x402 challenge. Preview tools are in the `FREE_TOOLS` set and stay free.

- **14 paid tools:** `crypto_prices`, `crypto_funding`, `defi_yields`, `pm_markets`,
  `chain_block_number`, `chain_gas_price`, `chain_balance`, `chain_token_balance`,
  `chain_tx`, `chain_wallet`, `chain_token_security`, `enrich_tech_risk`, `enrich_domain`,
  `scan_mcp_server`.
- **8 free tools:** `crypto_prices_preview`, `crypto_funding_preview`, `defi_yields_preview`,
  `pm_markets_preview`, `chain_block_number_preview`, `chain_gas_price_preview`,
  `chain_token_security_preview`, `scan_mcp_preview`.

The MCP surface is a **subset** of the HTTP surface: `/chain/code`, `/chain/receipt`,
`/dns`, and `/whois` have HTTP routes but **no MCP tool**.

## 5. Discovery / distribution surfaces

**In the code (served by the Worker):** `/.well-known/x402` (**count disputed** — this line says 16
routes, §3 says the 2026-07-20 fix brought it to all **18**; the live probe to re-settle it was
sandbox-blocked in the 2026-07-25 pass, so neither number is currently code-proven. Trust §3's
curl evidence over this line until re-probed),
`/openapi.json`, `/llms.txt`, `/.well-known/mcp-registry-auth`, `/.well-known/402index-verify.txt`.

**External registrations (mechanisms present in repo; state per handoffs, not re-verified live):**
- **MCP Registry:** `server.json` = `io.github.rezearcher/tech-risk` **v1.2.0**; published via
  `mcp-publisher`.
- **npm / local stdio MCP client:** `mcp-client/` (`x402-data-api-mcp`) — **built, not published.** See §11.
- **x402scan.com:** `register_x402scan.js` — SIWX wallet-sign to the registry API.
- **CDP Bazaar:** `seed_endpoint.js` (13-route table, one route per invocation, positional arg) and
  `seed_batch_cdp.js` (4-route batch loop with 12h cooldown, added by `t_1a11024d` — see §12); also
  `seed_raw_cdp.js` / `seed_cdp_pm.js` / `seed_normal_xpay.js` — catalog seed (search reported broken).
- **402index.io:** domain-verified via `/.well-known/402index-verify.txt`.

## 5a. Public source repo — SHIPPED 2026-07-19 (card `t_4fea70bb`, independently re-verified)

Unlike the §6 tasks below, this one **left a verifiable artifact.** The source is now a **public**
GitHub repo — `https://github.com/rezearcher/x402-data-api`. The local `.git/config` `origin`
remote points at it.

**Independently re-verified 2026-07-19** by the SRE pass (not taken from the card's own summary):
- `curl https://github.com/rezearcher/x402-data-api` → **HTTP 200** (was **404** as of 2026-07-18).
- GitHub API `.private == false`; `created_at 2026-07-19T18:07:21Z`.
- **Secrets gate:** the 7 gitleaks/trufflehog hits in the pushed tree are **all false positives** —
  every one is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, the canonical Circle-issued USDC
  contract on Base (public, appears in `src/index.ts` payment logic). **No private key, API key,
  or wallet seed** in the pushed tree. (The publish correctly blocked at this gate on the first
  run and completed only after the false-positive was confirmed.)

**What it unblocked:** the `non-github-url` label on **awesome-mcp-servers PR #10277** — the bot
requires a GitHub URL. PR body was updated to lead with the repo; `mergeable_state=clean`, still
open. It also gives Glama's auto-indexer a real repo to crawl.

**Caveats / not independently verified here:** the "54 commits" and "MIT" claims come from
`docs/DISTRIBUTION_STATUS.md` / `glama.json` — `glama.json` declares `"license": "MIT"`, but there
is **no `LICENSE` file in the working tree** and **no `license` field in `package.json`** (the
declared license is not backed by a working-tree artifact — see §8).

## 6. The five 2026-07-17/18 "completed" tasks — reality check (updated 2026-07-24 by SRE rescue pass)

**Original note (2026-07-19): these five kanban tasks closed 2026-07-17/18 with no committed
artifact in the repo — treated as unverified gaps.** Three of the five have since been **rescued
and independently re-verified** by the SRE maintenance loop (2026-07-24); the other two remain
unverified as originally noted.

| Task | Repo evidence | Verdict |
|---|---|---|
| `t_15d021aa` Prospector: research NEW demand + 3 distribution channels | None in repo — this thesis was re-done as `t_d6a7f9c9` (see below), which *did* land an artifact. | **Superseded** — the re-do closed the gap; treat `t_15d021aa` itself as archived/no-op. |
| `t_dd214b6b` Diagnose + draft nudges for 5 open distribution PRs | None in repo — this thesis was re-done as `t_de151427` (`docs/DISTRIBUTION_STATUS.md`, still pending SRE rescue as of 2026-07-24). | **Superseded** — see `t_de151427` backlog note in the SRE health log. |
| `t_a1408407` Apify Base RPC Actor — publish to 20k+ pipelines | **RESCUED 2026-07-18 (commit `f9c7b37`).** `apify-actor/` now contains `src/`, `README.md`, `requirements.txt` — a real, buildable Apify Actor proxying `/chain/gas-price`, `/chain/block-number`, `/chain/balance`, `/chain/token-balance`. | **PASS — built + committed.** Not independently verified as *deployed/live on Apify's platform* — that step still needs a human Apify account action (out of scope for autonomous work). |
| `t_39a77a4a` MCP Directory Flood — submit to 8 directories | **RESCUED 2026-07-24 (commit `ce8c048`).** `docs/MCP_SUBMISSIONS_LOG.md` documents 3 real submitted PRs/issues: `mcp.so` issue #3211, `awesome-mcp-servers` PR #10353 (independently re-verified live, HTTP 200, 2026-07-24), Docker MCP Registry PR. Remaining 4 of 8 need a human action (Smithery API key, npm publish, browser forms) — correctly logged as blockers, not false claims. | **PASS — genuine partial completion**, correctly self-scoped. |
| `t_e6242d7e` x402scan Composer + Bazaar Indexing | **RESCUED 2026-07-24 (commit `ce8c048`).** `docs/DISCOVERY_LISTING_STATUS.md` documents CDP Bazaar indexing (26/26 validation checks, verified via API) and two external PRs: `gold-402#38`, `awesome-x402#887`. **Caveat found 2026-07-24:** both PR repos (`sol-dispenser/gold-402`, `sol-dispenser/awesome-x402`) now 404 on GitHub — the repos themselves appear deleted/renamed since 2026-07-18, an external decay unrelated to this task's execution. | **PASS at time of work** (CDP Bazaar indexing is independently verifiable today and still live); the two GitHub PRs are no longer checkable due to upstream repo disappearance — do not claim them as durable distribution channels going forward. |

**`t_d6a7f9c9` REDO: Prospector research (2026-07-18, committed `6d5ce2b`, merged `ef06c2a`).**
`docs/DEMAND_RESEARCH.md` (204 lines) — 4-source research proposing 3 new channels (MCPize,
Apify Marketplace, Zyla API Hub) + a Stripe MPP angle; identified token-security as a zero-competitor
MCP-marketplace wedge. **PASS — genuine artifact, on main.**

## 6a. Dependabot cards (2026-07-18/19) — misdirected, no-op for this repo

Two kanban cards closed in the last 24h claiming Rust-crate bumps:

| Task | Claim | Repo evidence | Verdict |
|---|---|---|---|
| `t_ed83c170` | Update to **rustls 0.23.25** | `rustls` is a **Rust** TLS crate. This repo has **no `Cargo.toml`, no `Cargo.lock`, no `.rs` file**, and **zero** occurrences of `rustls` anywhere (grep-verified 2026-07-19). | **Misdirected / no-op.** Nothing to update; nothing changed here. |
| `t_c70a762b` | Update to **tokio 1.45.0** | `tokio` is the **Rust** async runtime. Same as above — no Rust toolchain, no `tokio` anywhere in the repo. | **Misdirected / no-op.** Nothing to update; nothing changed here. |

**Why the mismatch:** x402-data-api is a **TypeScript / Cloudflare Worker** (`package.json`,
`wrangler.toml`, `src/index.ts`). Its real dependency surface is **npm**, not Cargo. These
Dependabot cards target a Rust project and were routed to the wrong board — closing them left
**no artifact and no code change** here. **Do not** record "rustls/tokio updated" as shipped fact
for this service; it would be a doc lie. The actual dependencies are the npm packages pinned in
`package.json` (Hono 4, `@x402/*` 2.15, viem 2.55, `@modelcontextprotocol/*`, `@coinbase/cdp-sdk`,
zod 4) with `wrangler` as the toolchain — none Rust.

## 7. Doc-drift corrections (statements the code disproves)

- **MCP tool count.** Code has **22** tools. `README.md` said **19**; `docs/DISTRIBUTION_READY.md`
  said **11**. Both were wrong (README + DISTRIBUTION_READY corrected 2026-07-18).
- **Missing endpoints in README.** `/chain/token-security`, `/dns/:domain`, `/whois/:domain`
  are live + paid but were absent from the README endpoint tables (token-security added
  2026-07-18; `/dns` + `/whois` noted).
- **Paid-endpoint count.** `DISTRIBUTION_READY` said "15 paid endpoints (4 data + 8 Base RPC +
  3 security)". Actual = **18 paid GET endpoints** (adds `/chain/token-security`, `/dns`, `/whois`).
- **Funding venues.** Code fetches **Hyperliquid + OKX + dYdX**; README said only Hyperliquid + OKX
  (corrected 2026-07-18).
- **Seeder CLI flags that never existed.** `docs/AGENTIC_MARKET_ENRICHMENT.md` advertised
  `--workers-url` / `--dry-run` / `--route` on `seed_batch_cdp.js`; the file has **no `process.argv`
  handling at all** (corrected 2026-07-29, see §12). Correct invocations are
  `node seed_batch_cdp.js` (no args, all 4 manifest routes) and `node seed_endpoint.js <route>`.
- **`PLAN.md` status section is stale** — it lists only the two `/enrich/*` endpoints as the MCP
  surface; the shipped surface is 22 MCP tools / 18 paid HTTP endpoints. See this file for current state.

## 8. Explicit gaps (planned / claimed but not shipped here)

- **Revenue_ledger integration shipped (2026-07-20).** Task `t_91c6fca6` reconciled on-chain settlement data into a revenue_ledger system. The milestone sensor was previously blind to real revenue — the ledger now tracks actual Base mainnet settlement volume from the x402 payment protocol. Verifiable source: `revenue_ledger/` (kanban-claimed).
- **Revenue ledger audit — 96.25% self-traffic (2026-07-23).** Task `t_efa5b713` performed on-chain forensic verification of all 26 revenue_ledger rows via `eth_getTransactionReceipt` on Base mainnet, reading each row's USDC Transfer event `from` topic. Result: **23/26 rows ($0.385, 96.25%) are self-traffic** from buyer-wallet (`0xC4852c…`) and PAY_TO (`0x5765ae…`) addresses; 3 rows ($0.015) were provisionally external revenue from payer `0x7e571e…` — **since superseded, see next bullet.** Verifiable artifacts: `scripts/verify_revenue_ledger.py` (now 601 lines after `t_5c08554f`'s `--probe-check` extension, reusable RPC-based ledger auditor). Deliverable lives merged on `main` (commit `b2089a2` + `fcff3c8`); the ledger-audit script produces `~/.hermes/data/x402-data-api-revenue/ledger_verified_summary.json`. ~~Note: `docs/REVENUE_LEDGER_AUDIT.md` referenced by earlier passes does not exist on `main`~~ — **stale as of 2026-07-25: it does exist** (129 lines, read-verified), see §9.2.
- **Sole "external" payer confirmed farming bot — true organic revenue $0.00 (2026-07-24).** Task `t_5c08554f` probed the one remaining "external" address (`0x7e571e959cc7c75ccdd2eac24f8775ea2eaa2f09`) via live Base Blockscout API + `eth_getTransactionCount`: `nonce_tx_count=3176` (high-activity automation), `15×` identical `giveFeedback()` calls to one contract within a 120s window (sybil/reputation-farming signature), and `3` unsolicited farm-bait token receipts (HOLD/UHODL/USGR). Composite `probe_score=1.000`. **True organic x402 revenue is $0.00, not $0.015** — the $0.015 was itself noise, the third false-positive the same metric has produced across three passes (`t_91c6fca6` blind-$0→$0.395, `t_efa5b713` $0.395→$0.015 after excluding self-traffic, `t_5c08554f` $0.015→$0.00 after excluding bot traffic). Sidecar evidence: `~/.hermes/data/x402-data-api-revenue/probe_check_summary.json`. Deliverable merged to `main` at `fcff3c8` (was sitting unmerged on `wt/t_5c08554f` for one SRE cycle — rescued 2026-07-24).
- **First organic dollar: still $0, confirmed by a third independent pass.** Zero real humans or task-driven agents have ever knowingly paid for this API despite 8+ live distribution channels already up for days. The milestone target ($1.00 organic) requires the full **$1.00**, not $0.985 or $0.60. This strengthens the case for escalating the $20 outbound bounty (`t_33de6690`, blocked on Rez capital-approval) over another passive-listing card.
- **The npm atom (only Rez can do it):** `npm login` + `npm publish` from `mcp-client/`. The package
  is built, committed, and locally runnable (§11), but unpublished — so the `npx` install path that
  the MCP-directory submissions and `README.md` advertise does not work for anyone outside this repo.
- **The revenue atom (only Rez can do it):** create a **RapidAPI seller account + connect Stripe
  payout** at `rapidapi.com/provider`. The dual-rail (x402 + RapidAPI/Stripe) plan hinges on it;
  everything downstream (import `/openapi.json`, tiers, token-security as hero) is automatable once it exists.
- ~~**Apify actor:** not built (see §6).~~ **RESOLVED / was a doc lie** — `apify-actor/` exists in the
  working tree (`src/`, `README.md`, `requirements.txt`, ls-verified 2026-07-25) and §6 already records it
  as rescued at commit `f9c7b37`. This bullet contradicted §6 of the same file. **Remaining real gap:** not
  verified as *deployed/live on Apify's platform* — that needs Rez's Apify account.
- ~~**`/dns` + `/whois` discovery:** live but undiscoverable~~ **RESOLVED / was a doc lie** — §3 of this
  same file records both as added to `.well-known/x402` + `openapi.json` on 2026-07-20 (deploy `2887ef85`).
  This bullet was never updated. **Not re-probed live in the 2026-07-25 pass** (outbound curl was
  sandbox-blocked), so treat §3's 2026-07-20 curl evidence as the last verification.
- **No CI/CD or release pipeline.** The source repo is public (§5a) but has **no
  `.github/workflows/`** — no automated build, test, lint, or release. Both publication (`git push`)
  and deploy (`wrangler deploy`) are **manual**. A CI/release Action is planned-but-absent.
- **Glama listing still pending.** The repo blocker that broke it is resolved (§5a), but the
  Glama.ai listing itself is not done — it needs a passive 14-day crawl of the now-live repo or a
  manual browser submit at `glama.ai/mcp/servers/submit` (no public API). This is still Blocker A
  on awesome-mcp-servers PR #10277.
- ~~**No `LICENSE` file.**~~ **RESOLVED / was a doc lie** — verified 2026-07-25: `LICENSE` exists at repo
  root ("MIT License / Copyright (c) 2026 Grey Ridge Signals Group LLC"), `package.json:5` has
  `"license": "MIT"`, and `glama.json:24` matches. All three agree; the declared license is now backed
  by a real artifact. (Landed with commit `de349d5`.)
- **Next moat builds (not started):** indexed event history (free RPC caps `eth_getLogs` at ~10
  blocks → needs a D1/KV indexer, must respect the ~50-subrequest/invocation cap); cross-DEX
  best-quote/price-impact on Base; Aave/Moonwell near-liquidation monitor.

---

## 9. Doc-sync 2026-07-25 — four cards closed in the last 24h

Each row below was checked by **reading the artifact in the working tree**, not by trusting the card
title. Where the artifact lives outside this repo (Hermes config, hooks registry), the sandbox blocked
verification and it is written as a **gap**, not a fact.

### 9.1 `t_5c08554f` — probe-check mode / sole external payer is a farming bot — **SHIPPED**

**Code-proven.** `scripts/verify_revenue_ledger.py` is **601 lines** and really does implement a second
mode: `--probe-check` is parsed at `scripts/verify_revenue_ledger.py:586-595`, dispatching to
`run_probe_check(play)` at `:507`, which writes the sidecar
`~/.hermes/data/<play>-revenue/probe_check_summary.json` (`:510`) **without mutating** the normal-mode
files. The module docstring documents both modes (`:5`, `:11-21`). Invocation:
`python3 scripts/verify_revenue_ledger.py --probe-check [play_name]`.

Finding (already recorded in §8): payer `0x7e571e95…` scores `probe_score=1.000` on three
heuristics — nonce 3,176 (+0.40), 15× `giveFeedback()` in 120s (+0.35), 3 unsolicited farm tokens
(+0.25). **True organic revenue $0.00.**

### 9.2 `t_913952c8` — probe-likelihood addendum to the revenue audit — **SHIPPED**

**Code-proven.** `docs/REVENUE_LEDGER_AUDIT.md` exists on `main`, **129 lines**. The addendum starts at
`docs/REVENUE_LEDGER_AUDIT.md:68` ("Addendum: Probe-Likelihood Analysis of External Payer") with the
heuristic table (`:82-87`), per-heuristic derivations (`:91-95`), a revised impact table showing
`Organic human usage $0.000` (`:105`), prerequisites (`:109-118`), and a provenance note (`:122-129`)
explaining that this file was rescued from stranded branch `wt/t_efa5b713` and folded together with the
smaller duplicate that `t_5c08554f` / `t_913952c8` had landed separately.

> **Open inconsistency inside that doc (do not paper over):** the summary table says **26** total ledger
> rows (`:11`) while the addendum's motivation paragraph says **221** ledger rows (`:75`). Both cannot be
> right. The $ figures ($0.400 total / $0.385 self / $0.015 external) are internally consistent with the
> 26-row table, so **26 is the more likely correct figure** and `221` is probably a stale or
> different-window count — but this was **not** re-derived from the ledger in this pass. Re-run
> `verify_revenue_ledger.py` to settle it before quoting either number externally.

### 9.3 `t_70fcb2ca` — `revenue_usd_corrected` producer + milestone re-point — **HALF-PROVEN**

**Proven (in-repo):** `.metrics/compute_revenue_usd.py` reads *both* audit sidecars
(`ledger_verified_summary.json` + `probe_check_summary.json`), builds the set of `probe_likely`
addresses, sums only ledger rows classified `external` whose payer is **not** probe-flagged, and writes
the same value to **two** sibling files — `.metrics/revenue_usd` and `.metrics/revenue_usd_corrected`
(`OUTPUT_PATH` / `OUTPUT_PATH_CORRECTED`). Both files exist on disk and both read **`0.0`**. Both
sidecars are **hard-required** — the script `sys.exit(1)`s if either is missing.

**GAP — the "milestone.sh shadows the producer" half is NOT verified here.** The card's thesis is that
`milestone.sh` has a built-in branch for `name=revenue_usd` that shadows the producer file, and that the
fix was to re-point `milestone.json`'s `target_metric` to `revenue_usd_corrected`. Both `milestone.sh`
and `milestone.json` live **outside this repo** (Hermes config) and every read of them was
sandbox-blocked in this session. So:
- **Not proven:** that `milestone.json` currently has `target_metric: revenue_usd_corrected`.
- **Not proven:** that the milestone sensor now reads the producer file rather than its built-in branch.
- **Consequence if the re-point silently didn't land:** the milestone would keep reporting the *built-in*
  revenue number (historically the contaminated $0.395/$0.015 figures) instead of the corrected `0.0` —
  i.e. the exact false-positive this card existed to kill would still be live. Re-verify out-of-sandbox
  before trusting the milestone reading.

Note the producer writes the corrected value to **both** filenames, so `revenue_usd` and
`revenue_usd_corrected` can never disagree — the split is purely a hook to escape `milestone.sh`'s
name-matched built-in branch, not two different metrics.

### 9.4 `t_06390ee0` — auto-merge `wt/<task_id>` branches on kanban completion — **HALF-PROVEN**

**Proven (in-repo):** `scripts/auto-merge.sh` exists and is a real implementation, not a stub. It
resolves `task_id` from `HERMES_KANBAN_TASK` or, failing that, parses the hook's stdin JSON payload at
`extra.task_id` (`scripts/auto-merge.sh:11-28`); checks `wt/<task_id>` exists (`:37`); skips cleanly if
already an ancestor of `main` (`:50-55`); otherwise `git merge --no-ff`, then pushes `main` and deletes
the local + remote branch (`:58-68`). It is **fail-OPEN by construction** — every failure path is
`exit 0` and a bad merge calls `git merge --abort`, so it can never block a legitimate task completion.
Related: `.gitignore` now carries `/.worktrees/` with a comment explaining that per-card checkouts kept
the live repo permanently dirty and were at risk from a blind `git clean -fdx` (commit `246eceb`).

**GAP — registration is unverified and the hook has never been observed firing.**
- The mapping `kanban_task_completed → scripts/auto-merge.sh` lives in the **Hermes hooks registry
  outside this repo**; reading it was sandbox-blocked. A perfectly correct script that is not registered
  does nothing.
- **No commit in recent history carries the script's own merge-message signature** (`auto-merge: wt/…`).
  The recent worktree merges are all human/SRE **rescue** commits (`rescue: merge t_70fcb2ca worktree …
  was stranded pre-auto-merge-hook`, `rescue: merge t_913952c8 worktree …`) — i.e. evidence of the
  *problem*, not of the *fix* working.
- **Verdict: the fix is written but not yet demonstrated.** Do not record "worktree branches now
  auto-merge" as shipped reality until a commit titled `auto-merge: wt/<task_id> (task …)` appears on
  `main`. That commit is the acceptance test.
- `.worktrees/` currently holds **10+ per-card checkouts** (`t_06390ee0`, `t_1c2d2ef4`, `t_1f6f4a5a`,
  `t_33de6690`, `t_4fea70bb`, `t_5c08554f`, `t_70fcb2ca`, `t_736d0a19`, `t_7c5b0f37`, `t_913952c8`, …) —
  the hook deletes branches, not worktree directories, so stale checkouts still accumulate. Unresolved.

### 9.5 What none of these four changed

The revenue picture is unchanged and remains **$0.00 organic**. These cards improved the *honesty of the
measurement* (probe detection, corrected metric, audit doc) and the *plumbing* (auto-merge) — none of
them is a distribution or demand action. The first-dollar gap in §8 stands exactly as written.

---

## 10. SRE pass 2026-07-27 — Stripe rail rescued, worktree-bypass pattern found

**`t_aef95830` (PIVOT: Stripe-billed human rail) — rescued, PASS.** The coder committed its work
straight onto the **live main working tree** instead of its assigned worktree (`wt/t_aef95830`,
which stayed at its pre-work SHA). SRE verified the diff matched the card's own summary exactly,
`tsc --noEmit` clean, no secrets, then committed as `ae27bbe`: `GET /token-safety` landing page,
`POST /stripe/webhook` (HMAC-verified, KV-backed API key issuance), an API-key bypass middleware
ahead of the x402 gate, and `docs/TOKEN_SAFETY_STRIPE_PROBE.md`. **Still blocked on Rez:** the KV
namespace isn't created and Stripe secrets aren't set (both commented out / unset) — no deploy yet.

**`t_819dd337` (auto-merge.sh logging hardening) — rescued, PASS.** Same pattern: the fix (structured
`auto_merge_failures/<task_id>.log` on merge failure) landed directly on main as `10fdeb3`
("Closes t_819dd337"), while `wt/t_819dd337` stayed stale. `run_acceptance.sh`'s CHECK false-FAILed
against the stale worktree; re-run against main HEAD, it passes for real.

**`t_79490638` (A2A Agent Card) — correctly blocked, deliverable rescued to its own branch only.**
This card is legitimately `blocked` awaiting Rez's content-accuracy sign-off, but the Agent Card was
already deployed live to prod (version `125c4745`) while its worktree sat uncommitted — reap risk on
code actively serving traffic. Committed to `wt/t_79490638` (`d3dee9e`) only; **main untouched**,
still gated on review.

**Systemic finding (doctrine `x402-worktree-bypass-check-main-too`, review 2026-10-27):** twice in one
pass a coder bypassed its assigned worktree and committed straight to main. This silently defeats the
worktree-isolation / auto-merge safety net documented in §9.4 and false-negatives any acceptance CHECK
that only inspects the worktree. Rule going forward: an acceptance/rescue sweep must check the live
main tree (`git status` + `git log`) for the claimed fix before trusting a worktree-only FAIL/UNRESOLVED.

---

## 11. `mcp-client/` — local stdio MCP client (card `t_d792f3ba`, doc-sync 2026-07-28)

**Code-verified by reading the working tree**, not from the card title. Second component in the
repo alongside the Worker: `mcp-client/` is a self-contained npm package (`x402-data-api-mcp`
v0.1.0, MIT-implied via root `LICENSE`) that runs **on the installing agent's machine** and speaks
MCP over **stdio**, proxying to the already-deployed Worker's HTTP `/mcp`. It adds no new data
surface — it is a transport + payment shim so stdio-only clients (Claude Desktop, Cursor) can reach
the 22 remote tools.

**What is actually in the tree:**

| File | Evidence |
|---|---|
| `mcp-client/package.json` | `"bin": {"x402-data-api-mcp": "./dist/server.js"}`, `"type": "module"`, `"files": ["dist/"]`, `prepublishOnly: npm run build`. Deps: `@modelcontextprotocol/sdk ^1.29.0`, `@x402/fetch`/`@x402/evm`/`@x402/core` `^2.19.0`, `viem ^2.55.0`, `zod ^4.4.3`. |
| `mcp-client/src/server.ts` | 149 lines — the whole implementation. |
| `mcp-client/dist/` | Compiled `server.js` (+ `.d.ts`, maps) **committed** — `.gitignore` ignores `node_modules/` only, so the `bin` target ships. Shebang `#!/usr/bin/env node` present. |
| `mcp-client/package-lock.json` | 114 resolved packages — deps really were installed/built. |
| `mcp-client/test-mcp-client.mjs` | 143-line harness: spawns `dist/server.js`, asserts all 22 tool names in `tools/list`, then calls 4 free previews (`chain_block_number`, `crypto_prices`, `chain_gas_price`, `chain_token_security`) against **live production**. |
| `mcp-client/README.md` | 90 lines — quick start, 22-tool table, free/paid split, dev loop. |

**Payment path (code-proven, `src/server.ts:29-56`).** The wallet key comes from
`X402_WALLET_PRIVATE_KEY` — **the installer's own key**, read from their env; no key, seed, or
wallet file for this client exists in the repo. When set: dynamic `import()` of
`wrapFetchWithPayment` (`@x402/fetch`), `x402Client` (`@x402/core/client`),
`registerExactEvmScheme` (`@x402/evm/exact/client`), and `privateKeyToAccount` (`viem/accounts`);
the wrapped fetch replaces `globalThis.fetch` for all Worker calls, so a 402 challenge is signed and
retried transparently. Init failure is **non-fatal** — it logs to stderr and falls back to plain
fetch (free/preview tools only), same as running with no key at all (`:50-56`). Target URL is
`WORKER_BASE_URL` (default `https://x402-data-api.sigrunner.workers.dev`) + `/mcp` (`:32`, `:76`).

**Response handling (`:87-113`):** parses JSON first, else scans for SSE `data: ` lines and takes
the last valid JSON one; on neither, synthesizes a JSON-RPC error carrying the HTTP status.

**Scope of the proxy — narrower than its own docstring claims.** Only **two** handlers are
registered: `ListToolsRequestSchema` (`:117`) and `CallToolRequestSchema` (`:131`). Capabilities
declare `tools` only (`:65-69`). `initialize` is answered **locally by the MCP SDK**, not proxied,
so the header comment "Proxies all MCP JSON-RPC calls (tools/list, tools/call, initialize, etc.)"
(`src/server.ts:6-7`) overstates it. No `resources`, no `prompts`, no notification pass-through.
Not a defect for this use case — recorded so the doc isn't repeating the code's own overstatement.

### Gaps (claimed or implied but **not** proven in the tree)

- **Not published to npm.** Nothing in the repo proves `x402-data-api-mcp` exists on the registry,
  and the registry probe was sandbox-blocked in this pass. `docs/MCP_SUBMISSIONS_LOG.md:71-72` states
  the remaining atom is Rez's `npm login` + `npm publish` (+ `mcp-publisher register`) — an account
  action, correctly out of scope for autonomous work. **Until that lands, every `npm install -g` /
  `npx x402-data-api-mcp` instruction in `mcp-client/README.md` fails for an outside installer**;
  only the in-repo `node dist/server.js` path works. The README's "Or run directly from the repo:
  `npx x402-data-api-mcp`" is wrong on both counts (it resolves against the registry, not the repo).
- **`README.md` step 1 points at a file that does not exist.** It says to copy `.env.example` to
  `.env`; there is no `.env.example` in `mcp-client/` (ls-verified). The two env vars are read
  straight from `process.env`, so the instruction is inert, not blocking.
- **The "5/5 live tests pass" claim is documentation, not evidence.** The harness exists and is real,
  but no run output is stored in the repo; the pass claim lives only at
  `docs/MCP_SUBMISSIONS_LOG.md:71`. Re-run `node mcp-client/test-mcp-client.mjs` to re-establish it.
- **Paid-path never demonstrated.** All 5 tests exercise **free previews**. No artifact shows a 402
  challenge being signed and settled through this client — the x402 wiring is code-reviewed, not
  round-trip-proven.
- **Invisible on the repo's own discovery surfaces.** Root `README.md`, `server.json`, and
  `glama.json` contain **zero** references to `mcp-client` / `x402-data-api-mcp` (grep-verified).
  `server.json` still describes only the remote server (`io.github.rezearcher/tech-risk` v1.2.0).
  A visitor to the public repo cannot discover the client exists.
- **Two independent version identities.** npm package `0.1.0` vs `server.json` `1.2.0`. Nothing
  syncs them; the 22-tool list is hardcoded in `mcp-client/README.md` + the test harness and will
  drift silently if the Worker's tool set changes.
- **No CI.** Per §8 there is still no `.github/workflows/`, so `npm run build` / the test harness
  run only when someone runs them by hand.

**Revenue note:** this is a distribution mechanism, not revenue. It changes nothing in §8 — organic
revenue remains **$0.00**, and this package cannot begin to move that number until it is on npm.

---

## 12. `seed_batch_cdp.js` — batch CDP Bazaar seeder (card `t_1a11024d`, doc-sync 2026-07-29)

Card title: *"Fix Agentic.Market enrichment gap: extend proven CDP-seed to token-security + Base-RPC
(category-matched buyer demand proven live)."* **Read-verified against the tree**, not taken from the
title. Landed via SRE rescue `ac53946` (deliverable had been stranded on `wt/t_1a11024d`); the
underlying work is commit `7627eaa`.

**What actually shipped:**

| Artifact | Evidence |
|---|---|
| `seed_batch_cdp.js` | 237 lines at repo root. Iterates a hardcoded 4-route manifest (`/pm/markets`, `/chain/token-security`, `/chain/gas-price`, `/chain/block-number`), does challenge → sign → settle per route. |
| Cooldown persistence | `.cdp_seed_cooldown.json`, 12h window (`:16-17`, `:112-121`, `:148-153`). Entry is written **only on the success path** (`:218`), so a present entry = a settle that returned OK. |
| Settle path | POSTs `{paymentPayload, paymentRequirements}` to the Worker's `/internal/cdp-settle-raw` (`:206-211`) — that route **exists**, `src/index.ts:232` (`app.post`). Bypasses the ajv-on-Workers wall. |
| Bazaar extension | `declareDiscoveryExtension()` from `@x402/extensions/bazaar` per route, plus a manual `bazaar.info.input.type/method` + `routeTemplate` patch for x402 issue #2156 (`:169-176`). |
| Wallet | `buyer-wallet.json` at repo root, loaded at `:126`; signs via viem + `registerExactEvmScheme` on `eip155:8453`. |
| `seed_endpoint.js` | 13-route registration table **does** include `/chain/token-security` (`:99`) and the full Base-RPC set (block-number, gas-price, balance, token-balance, tx, receipt, code, wallet) — this is the "extend to token-security + Base-RPC" part of the card, and it is real. |

**How to run it (correcting the docs):** `node seed_batch_cdp.js` with **no arguments**.
`node seed_endpoint.js <route>` takes one **positional** route name (`seed_endpoint.js:158`).

### Gaps / doc lies found in this pass

- **`docs/AGENTIC_MARKET_ENRICHMENT.md` claimed CLI flags that do not exist.** It advertised
  `--workers-url`, `--dry-run`, and `--route` on `seed_batch_cdp.js`. The file contains **zero**
  `process.argv` references (grep-verified); `BASE` is hardcoded at `:15` and the manifest at `:21`.
  There is no dry-run and no route filter — a run always attempts real on-chain settles for every
  non-cooled-down route. Corrected in that file 2026-07-29. **Real gap:** if a dry-run / target
  override is wanted, it still has to be written.
- **The "❌ Insufficient USDC" rows in that doc are contradicted by the repo's own artifact.**
  `.cdp_seed_cooldown.json` holds success entries for **all four** routes — including `/pm/markets`
  and `/chain/token-security`, the two the doc lists as failed — stamped within a ~2.5s window
  (cooldown expiry `2026-07-29T03:09:31–34Z` ⇒ seeds at **`2026-07-28T15:09:31–34Z`**). Since the
  cooldown key is only set after a non-error settle response, either all four settled or the doc's
  failure table is from a different run. **Not resolved here** — treat both the failure rows and the
  "4/4 seeded" reading as unproven until a fresh run is captured.
- **Those doc timestamps were cooldown-*expiry* times, not seed times.** `seed_run_1785253314.log`
  is an all-SKIP run (`Seeded: none`), and its `cooldown until …T03:09:3xZ` lines are what got
  transcribed into the doc as seed times. Corrected.
- **Agentic.Market enrichment itself is still NOT fixed** — the card's actual headline goal. There is
  no enrichment code, no enrichment call, and nothing in the repo that sets `description`/`category`
  on the Agentic.Market service record. The doc's own status table shows `enriched: False`,
  `description: ""`, `category: ""`. What shipped is **CDP Bazaar seeding**, which is upstream of
  Agentic.Market's own enrichment pipeline. **Open gap.**
- **Live seeding state not re-probed in this pass** (docs-only, no network). The last on-chain claim
  (tx `0xb5ab7…33a`, block 49,231,013) comes from the card's own summary and is **not** independently
  verified here.
- **Revenue impact: none.** Per §8, organic revenue remains **$0.00**. Catalog seeding is discovery
  plumbing; `/chain/token-security` still shows zero paid calls ever.

---

*See `docs/FIRST_DOLLAR_PLAYBOOK.md` (thesis + outreach targets), `docs/DISTRIBUTION_READY.md`
(distribution state), `docs/QUALITY_UPGRADE_PLAN.md` (endpoint quality), and
`docs/MARKET_ANALYSIS_2026-07-16.md` (market thesis). This file supersedes their code-level claims.*
