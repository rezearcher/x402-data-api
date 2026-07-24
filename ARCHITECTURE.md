# ARCHITECTURE — x402-data-api

**Source of truth for what is actually shipped.** Verified against `src/index.ts` on
2026-07-21; dependency/Dependabot cards re-checked against the manifests on 2026-07-21 (see §6a);
the public source-repo publication (card `t_4fea70bb`) was independently re-verified 2026-07-21 (see §5a);
Where a claim in another doc conflicts with the code, the code wins and the
conflict is recorded in [Doc-drift corrections](#doc-drift-corrections). Prices, counts,
and route lists below were read out of the code, not copied from prose.

---

## 1. What it is

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

**In the code (served by the Worker):** `/.well-known/x402` (16 routes for x402 crawlers),
`/openapi.json`, `/llms.txt`, `/.well-known/mcp-registry-auth`, `/.well-known/402index-verify.txt`.

**External registrations (mechanisms present in repo; state per handoffs, not re-verified live):**
- **MCP Registry:** `server.json` = `io.github.rezearcher/tech-risk` **v1.2.0**; published via
  `mcp-publisher`.
- **x402scan.com:** `register_x402scan.js` — SIWX wallet-sign to the registry API.
- **CDP Bazaar:** `seed_endpoint.js` / `seed_*.js` — catalog seed (search reported broken).
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
- **`PLAN.md` status section is stale** — it lists only the two `/enrich/*` endpoints as the MCP
  surface; the shipped surface is 22 MCP tools / 18 paid HTTP endpoints. See this file for current state.

## 8. Explicit gaps (planned / claimed but not shipped here)

- **Revenue_ledger integration shipped (2026-07-20).** Task `t_91c6fca6` reconciled on-chain settlement data into a revenue_ledger system. The milestone sensor was previously blind to real revenue — the ledger now tracks actual Base mainnet settlement volume from the x402 payment protocol. Verifiable source: `revenue_ledger/` (kanban-claimed).
- **Revenue ledger audit — 96.25% self-traffic (2026-07-23).** Task `t_efa5b713` performed on-chain forensic verification of all 26 revenue_ledger rows via `eth_getTransactionReceipt` on Base mainnet, reading each row's USDC Transfer event `from` topic. Result: **23/26 rows ($0.385, 96.25%) are self-traffic** from buyer-wallet (`0xC4852c…`) and PAY_TO (`0x5765ae…`) addresses; 3 rows ($0.015) were provisionally external revenue from payer `0x7e571e…` — **since superseded, see next bullet.** Verifiable artifacts: `scripts/verify_revenue_ledger.py` (now 601 lines after `t_5c08554f`'s `--probe-check` extension, reusable RPC-based ledger auditor). Deliverable lives merged on `main` (commit `b2089a2` + `fcff3c8`); the ledger-audit script produces `~/.hermes/data/x402-data-api-revenue/ledger_verified_summary.json`. Note: `docs/REVENUE_LEDGER_AUDIT.md` referenced by earlier passes does not exist on `main` — creating it (with a probe-likelihood addendum) is tracked in follow-up card `t_913952c8`.
- **Sole "external" payer confirmed farming bot — true organic revenue $0.00 (2026-07-24).** Task `t_5c08554f` probed the one remaining "external" address (`0x7e571e959cc7c75ccdd2eac24f8775ea2eaa2f09`) via live Base Blockscout API + `eth_getTransactionCount`: `nonce_tx_count=3176` (high-activity automation), `15×` identical `giveFeedback()` calls to one contract within a 120s window (sybil/reputation-farming signature), and `3` unsolicited farm-bait token receipts (HOLD/UHODL/USGR). Composite `probe_score=1.000`. **True organic x402 revenue is $0.00, not $0.015** — the $0.015 was itself noise, the third false-positive the same metric has produced across three passes (`t_91c6fca6` blind-$0→$0.395, `t_efa5b713` $0.395→$0.015 after excluding self-traffic, `t_5c08554f` $0.015→$0.00 after excluding bot traffic). Sidecar evidence: `~/.hermes/data/x402-data-api-revenue/probe_check_summary.json`. Deliverable merged to `main` at `fcff3c8` (was sitting unmerged on `wt/t_5c08554f` for one SRE cycle — rescued 2026-07-24).
- **First organic dollar: still $0, confirmed by a third independent pass.** Zero real humans or task-driven agents have ever knowingly paid for this API despite 8+ live distribution channels already up for days. The milestone target ($1.00 organic) requires the full **$1.00**, not $0.985 or $0.60. This strengthens the case for escalating the $20 outbound bounty (`t_33de6690`, blocked on Rez capital-approval) over another passive-listing card.
- **The revenue atom (only Rez can do it):** create a **RapidAPI seller account + connect Stripe
  payout** at `rapidapi.com/provider`. The dual-rail (x402 + RapidAPI/Stripe) plan hinges on it;
  everything downstream (import `/openapi.json`, tiers, token-security as hero) is automatable once it exists.
- **Apify actor:** not built (see §6).
- **`/dns` + `/whois` discovery:** live but undiscoverable — not in `.well-known/x402` or `openapi.json`.
- **No CI/CD or release pipeline.** The source repo is public (§5a) but has **no
  `.github/workflows/`** — no automated build, test, lint, or release. Both publication (`git push`)
  and deploy (`wrangler deploy`) are **manual**. A CI/release Action is planned-but-absent.
- **Glama listing still pending.** The repo blocker that broke it is resolved (§5a), but the
  Glama.ai listing itself is not done — it needs a passive 14-day crawl of the now-live repo or a
  manual browser submit at `glama.ai/mcp/servers/submit` (no public API). This is still Blocker A
  on awesome-mcp-servers PR #10277.
- **No `LICENSE` file.** `glama.json` declares MIT, but the working tree has no `LICENSE` file and
  `package.json` has no `license` field — the declared license lacks a repo artifact.
- **Next moat builds (not started):** indexed event history (free RPC caps `eth_getLogs` at ~10
  blocks → needs a D1/KV indexer, must respect the ~50-subrequest/invocation cap); cross-DEX
  best-quote/price-impact on Base; Aave/Moonwell near-liquidation monitor.

---

*See `docs/FIRST_DOLLAR_PLAYBOOK.md` (thesis + outreach targets), `docs/DISTRIBUTION_READY.md`
(distribution state), `docs/QUALITY_UPGRADE_PLAN.md` (endpoint quality), and
`docs/MARKET_ANALYSIS_2026-07-16.md` (market thesis). This file supersedes their code-level claims.*
