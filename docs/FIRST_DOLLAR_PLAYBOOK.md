# First-Dollar Playbook — x402-data-api

**Goal (Rez, 2026-07-16):** make our FIRST organic dollar — a real *external* agent pays USDC to
call one of our endpoints. **Win by being undeniable** (mastery, not milestone-faking). Self-payment
/ wash-trade is explicitly NOT the first dollar.

---

## Corrected thesis (supersedes the "market's clock" conclusion)

The prior handoff concluded the first dollar was *exogenous — wait for organic discovery*. **That is
wrong.** Evidence gathered 2026-07-16:

- **Passive discovery is dead ecosystem-wide (not our bug).** CDP Bazaar `/discovery/search` returns
  **0 results for everyone** (even incumbents); the catalog is ~**25.5k listings** popularity-sorted
  with our 0-call listings at the tail; **`type=mcp` is 0-indexed**; the CDP Facilitator doesn't emit
  the `EXTENSION-RESPONSES` header needed to index. We settle via **xpay**, not CDP, so we're not even
  in CDP's settle-catalog flow.
- **But demand is real and lopsided:** ~**4:1 buyers-to-sellers**; **data APIs are the #1 earning
  category**. Top organic earners gross ~$3K/mo.
- **Our uncontested white-space:** **Base-chain RPC data.** OneSource — the RPC leader at 340–416
  payers/endpoint — is **Ethereum-only with no price oracle**. Base + USD fields are structurally ours.

**⇒ The first dollar comes from ACTIVE DISTRIBUTION, not waiting.** Put our free-to-try, white-space
endpoints in front of builders who pull.

## Verified working (the "undeniable" floor) — 2026-07-16

- **Payment rail works.** 402 challenge is spec-correct x402 v2 in the `payment-required` response
  header (base64), decoding to `scheme:exact / network:eip155:8453 / asset:USDC / payTo:0x5765… /
  extensions.bazaar`. An agent **can pay us today**. (Empty `{}` body is normal.)
- **MCP pull-channel works.** `initialize` handshake + `tools/list` return **19 tools** live (incl. the
  Base-RPC `chain_*` reads — our white-space, now in the pull channel); paid tools trigger x402, free
  `*_preview` tools let a builder try first.
- **Endpoints live.** `/health` 200; `/crypto/*`, `/defi/yields`, `/pm/markets` previews return real
  data. 15+ paid routes, $0.001–$0.10 USDC on Base.
- **Published on the official MCP Registry:** `io.github.rezearcher/tech-risk` **v1.2.0** (data-forward
  description), remote `https://x402-data-api.sigrunner.workers.dev/mcp`.

## Gaps found + RESOLVED this session (undeniable-floor work)

- ✅ **`GET /` 404 → landing page shipped** (`975adda`, deployed): self-contained HTML pitch at `/`
  (endpoint/price table, free curl, MCP install one-liner, discovery links). Listings no longer hit a dead root.
- ✅ **Base-RPC in the MCP pull-channel** (`975adda`): added 8 `chain_*` MCP tools (11→19) so our
  white-space is what a builder installs — makes the outreach "Base RPC via MCP" claim true.
- ✅ **Phase 0 correctness bugs fixed** (`db173e7`, deployed): `/scan/mcp` false-clean (both paths),
  `exploit_available`, crt.sh subdomains, EIP-7702, funding venues — all verified live + verifier-reviewed.

---

## Channels — ranked, with status

| # | Channel | Type | Status | Owner |
|---|---------|------|--------|-------|
| 1 | **Targeted 1:1 outreach** to named x402 agent-builders (free trial of Base-RPC/crypto) | Human pull | ✅ **Bankr (top target) reached via its INVITED skills catalog — [BankrBot/skills PR #573](https://github.com/BankrBot/skills/pull/573)** (our `grey-ridge-x402` skill next to Zerion/Alchemy). Warmer cold 1:1s on strangers' *product* repos + X/Farcaster DMs remain Rez's call (reputation). | Mixed |
| 2 | **awesome-x402** curated list (PR #868, OPEN, mergeable) | Curated pull | ✅ Reframed → Base-RPC-first + working `/llms.txt` link (`3a9cfee`); awaiting maintainer merge | Auto |
| 3 | **awesome-mcp-servers** (90.8k★, agent-PR fast-track w/ `🤖🤖🤖`) | Curated pull | ✅ **PR #10277 OPEN** (via classic token); awaiting merge | Auto |
| 4 | **MCP catalogs** — Registry ✓; **Glama ✗** (remote, needs claim); mcp.so / PulseMCP (web-form submit) | Crawler pull | Registry covered; claim/submit others | Auto (mostly) |
| 5 | **Dual-rail RapidAPI / Stripe** for human/API-key buyers (Rez's stated preference) | Human market | Needs Rez's account/tokens | Rez-atom |

**Ruled out (do not revisit):** cold-spam email from sigrunner.com (shared reputation — Rez's call);
wash-trading / self-payment as "first dollar"; more MCP-scanner-only build (dead category d/s=14);
X/PII scraping (legal). Note: *personalized 1:1 dev outreach is NOT cold-spam.*

## The autonomous / Rez-atom split

- **Autonomous (I do, no Rez):** Phase 0 fixes → landing page → reframe/submit the curated-list PRs
  (#2, #3) → claim/submit MCP catalogs (#4) → keep the product undeniable.
- **Rez-atom (only he can):** approve/send the 1:1 outreach (his identity/reputation), and/or greenlight
  the RapidAPI dual-rail with his account. That's the legal-gate-equivalent here.

---

## Outreach targets + message

Researched 2026-07-16. Full detail (all 24 targets, ranking rationale) in Division memory + this
session. **The SEND is Rez's atom** (his identity/reputation on GitHub/X/Farcaster). Everything below
is ready to fire — Rez picks targets, approves the message, or authorizes a project identity to send.

### Tier S — best next paying call (warmest first)

| # | Target | Reach | Why / shortest path | Endpoint fit |
|---|--------|-------|---------------------|--------------|
| 1 | **BlockRunAI** | [github/BlockRunAI/polymarket-agent](https://github.com/BlockRunAI/polymarket-agent) · [@BlockRunAI](https://x.com/BlockRunAI) | **Shortest sales cycle** — already pays x402 on Base, just not for RPC data yet. Pure upsell. | `/pm/markets`, `/chain/gas-price`, `/chain/balance` |
| 2 | **Capacitr** | [@capacitr](https://x.com/capacitr) · [capacitr.xyz](https://capacitr.xyz) | Only confirmed **dual buyer+seller** of x402 data on Base — zero protocol education needed. Matches narratives→PM/perps markets. | `/pm/markets`, `/crypto/prices` |
| 3 | **Aeon** (@aaronjmars) | [github/aaronjmars/aeon](https://github.com/aaronjmars/aeon) · [@aeonframework](https://x.com/aeonframework) | Solo builder, 59 skills incl. crypto/Base/Polymarket packs + explicit x402 support. High response-rate, exact fit. | `/crypto/prices`, `/chain/*`, `/pm/markets`, MCP |
| 4 | **AgentPay** (VedantAnand17) | [github/VedantAnand17/AgentPay](https://github.com/VedantAnand17/AgentPay) | Hackathon build: Base agent doing autonomous Uniswap trades via `x402-fetch`. Solo, near-perfect fit. | `/chain/gas-price`, `/chain/balance`, `/chain/tx`, `/crypto/prices` |
| 5 | **Bankr** | [@bankrbot](https://x.com/bankrbot) · [github/BankrBot/skills](https://github.com/BankrBot/skills) (1.2k★) | **Highest EV** — Base's showcase agent; public skill catalog already ships RPC/portfolio/Polymarket skills = proven demand. Reach via a normal issue on `BankrBot/skills`. | `/chain/*`, `/crypto/prices`, `/defi/yields` |

### Tier A — warm (org/GitHub reach): CardZero, kinance (Claude+x402 angle), Legasi (x402 hackathon 2nd), Polymarket/agents (official, fork-base), MoltPe, Virtuals, ATXP (list among "100+ tools"), Pyrimid, Warden, Gatefare, TrustBench, OpenGradient.

### Tier B — channel plays (many builders per touch): Apify (20k+ Actors), Neynar (Farcaster infra Slack), Builders Garden + Dev3Pack + Simone Staffa (Agentic Bootcamp organizers), **24K Labs gold-402** (300+ x402 directory — submit for inclusion), inference.sh.

**Excluded (checked):** CoinMarketCap x402 API + Satoshi API are competitors (sellers), not buyers. Do not fabricate the Agentic Bootcamp cohort roster (not public) — go via Builders Garden / Simone Staffa.

### Drafted 1:1 message (131 words — `[PERSONALIZE]` slots)

> Hey [name] — saw [specific project/repo], nice work. I run a small x402 data API that's **Base-native**
> (most x402 data sellers are Ethereum-only), so it might slot in cleanly wherever you're already pulling
> on-chain reads or market data.
>
> Free to try, no wallet needed:
> `curl -s https://x402-data-api.sigrunner.workers.dev/chain/gas-price/preview`
>
> Full 19-tool MCP server (Base RPC, crypto prices, cross-venue funding, DeFi yields, Polymarket) — one line:
> `{"mcpServers":{"grey-ridge-x402":{"type":"streamable-http","url":"https://x402-data-api.sigrunner.workers.dev/mcp"}}}`
>
> Paid calls are $0.001 each in USDC over x402 on Base when you're ready — no account, your agent just pays
> inline. Happy to comp a few dozen calls on your wallet to kick the tires on [their use case]. Feedback
> welcome either way — [your name]

(Farcaster 244-char + GitHub-issue variants also drafted — in the research output.)

### Channel norms (so it reads as a tool-share, not spam)
- **X:** reply to a recent post with the curl one-liner (public, low-commitment) before any DM. Best for Bankr, BlockRunAI, Aeon, OpenGradient, Apify.
- **GitHub:** prefer a **Discussion** over an Issue; star/fork first; never an uninvited PR *except* PR-welcoming awesome-* lists. Best for kinance, ATXP, Gatefare, Polymarket/agents.
- **Farcaster:** dev channels (`/base`, `/x402`, `/dev3pack`) welcome genuine shares; engage in-thread before DC. Best for Aeon, Capacitr, Builders Garden.
- **Discord:** #showcase channels only; cold-DM is a bannable norm violation. Apify, inference.sh, OpenGradient.
