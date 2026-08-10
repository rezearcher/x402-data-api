# x402 Data API — Value-First Outreach Target List

**Product:** `https://x402-data-api.sigrunner.workers.dev` — 15+ endpoints, AI agents pay per-call in USDC on Base.
**Lead with (proven-demand, bug-free white-space):**
- **Base-chain RPC** — `/chain/block-number`, `/chain/gas-price`, `/chain/balance`, `/chain/token-balance`, `/chain/tx`, `/chain/wallet` ($0.001 each). *Leading competitor OneSource is Ethereum-only → Base is uncontested.*
- **Crypto data** — `/crypto/prices`, `/crypto/funding` (cross-venue arb), `/defi/yields`
- **Polymarket** — `/pm/markets`
- **MCP server** — 11 tools, installable at `/mcp`

**Why outreach, not directory discovery:** passive CDP Bazaar discovery is broken ecosystem-wide. Path to first paying call = getting free-to-try endpoints in front of specific builders who already consume this data.

**Market context (for framing, not the pitch):** x402 Bazaar indexes ~1,000 services (938 on Base); Base cumulative x402 tx >119M, volume >$35M (Mar 2026, Chainalysis). The ecosystem is *saturated with "intelligence/signals" wrappers* but **thin on raw Base-chain RPC primitives** — that's our wedge.

---

## 1. NAMED TARGETS (23)

Grouped by type. Each: handle · reach · what they build · endpoint fit · source.

### A. Direct data-consumers — agents that need Base/crypto/PM data (warmest)

| # | Target | Reach | What they build | Endpoint fit | Source |
|---|--------|-------|-----------------|--------------|--------|
| 1 | **Gina** (askgina.eth) | Farcaster `farcaster.xyz/askgina.eth` · site `askgina.ai` | Onchain AI wallet assistant — checks balances/PnL/swap history by Farcaster username across EVM + Solana | `/chain/balance`, `/chain/wallet`, `/crypto/prices` | neynar.com/blog/building-ai-agents-on-farcaster · askgina.ai/docs |
| 2 | **Bankr** | X `@bankrbot` · Farcaster `bankr` · `bankr.bot` · `docs.bankr.bot` | Multi-platform AI crypto agent — trades, checks prices/balances, bets Polymarket, deploys Base tokens. **Also runs x402 Cloud** (API hosting + agent discovery) → buyer AND distribution channel | `/chain/*`, `/crypto/*`, `/pm/markets`, MCP | bankr.bot · chainwire.org/2026/04/02/bankr-launches-x402-cloud |
| 3 | **kinance** | GitHub `github.com/kinance` (x402-anthropic-python / -typescript) | Drop-in Anthropic SDK wrapper that auto-pays x402 402s on Base/ETH/Solana — deepest in the Claude+x402 tooling, most likely to actually run a curl/MCP install | Base RPC, MCP | github.com/kinance/x402-anthropic-python |
| 4 | **Legasi** | X `@legasi_xyz` · GitHub `github.com/legasicrypto` · `evm.legasi.io` | Agentic credit infra — credit lines, x402 payments, **yield on idle funds**, on-chain reputation for agents (Base Sepolia + SKALE). 2nd place SF Agentic Commerce x402 Hackathon | `/defi/yields`, `/chain/balance`, `/crypto/prices` | skale.space/blog/san-francisco-agentic-commerce-x402-hackathon-recap-winners · dorahacks.io/buidl/39347 |
| 5 | **AgentVault** | GitHub `github.com/anythingai/angentvault` | Autonomous crypto investment agent — analyzes markets 24/7, executes trades in risk params, x402-monetized. *Verify recent commit activity first* | `/crypto/prices`, `/crypto/funding`, `/chain/token-balance`, `/chain/tx` | cdp-agentkit-hackathon.devfolio.co · github repo |
| 6 | **Bracky** | Farcaster `farcaster.xyz/bracky` | Farcaster-native AI sports-betting / prediction agent running in-feed prediction markets (NBA etc.) | `/pm/markets` | neynar.com/blog/building-ai-agents-on-farcaster |
| 7 | **CardZero** | `cardzero.ai` | ERC-4337 smart-contract wallet for AI agents on Base; buyer-side x402 (`POST /v1/x402/pay`), on-chain spend rules. Every agent on it needs live gas/balance | `/chain/gas-price`, `/chain/balance`, `/chain/wallet` | github.com/Merit-Systems/awesome-x402 |
| 8 | **Clanker** | Farcaster (tag `@clanker`) · `clanker.world` | AI agent that deploys ERC-20s + Uniswap V3 pools on Base from NL casts ($50M+ cumulative fees; acquired by Farcaster) | `/chain/token-balance`, `/chain/tx`, `/chain/gas-price` | neynar blog · thedefiant.io Farcaster-acquires-clanker |
| 9 | **aixbt** | X `@aixbt_agent` · `app.virtuals.io/virtuals/1199` · docs `aixbt-labs.gitbook.io` | Autonomous on-chain intelligence agent parsing Base data + social sentiment for trading signals (Virtuals Protocol) | Base RPC, `/crypto/prices`, `/crypto/funding` | neynar blog · basechain.news |
| 10 | **World of Geneva** | DoraHacks `dorahacks.io/buidl/39336` | MMORPG where AI agents autonomously quest/trade with a fully on-chain economy. **1st place** SF Agentic Commerce x402 Hackathon (Feb 2026) | `/chain/wallet`, `/chain/tx`, `/crypto/prices` | skale.space hackathon recap |

### B. Builders Garden — bootcamp co-hosts / studio (warm; small + reachable + can introduce their cohort)

The Farcaster "Agentic Bootcamp" (Dev3Pack + Builders Garden, Mar 30–Apr 10 2026, 279 registered) is **confirmed real**, but no public list of cohort graduates surfaced (lived in private TG/Farcaster + FarHack). Highest-confidence targets are the co-hosts who teach *and build* this exact stack on Base.

| # | Target | Reach | What they build | Endpoint fit | Source |
|---|--------|-------|-----------------|--------------|--------|
| 11 | **Builders Garden** (org) | `builders.garden` · GitHub `github.com/builders-garden` | AI-driven product studio — onchain apps, AI agents, agent-identity (`siwa`) + agent-discovery (`majordomo`) tooling | Base RPC, crypto, MCP | builders.garden · github.com/builders-garden |
| 12 | **Simone Staffa** (limone.eth) | Farcaster `farcaster.xyz/limone.eth` · X `@limone_eth` · `limone.lol` | BG co-founder; Farcaster miniapps + AI agents (Farville, Betttr, pointsbot) | Base RPC, MCP | limone.lol |
| 13 | **Paolo Rollo** (orbulo) | Farcaster `farcaster.xyz/orbulo` · GitHub `github.com/PaoloRollo` | BG co-founder; full-stack web3+AI, core on BG agent products | Base RPC, MCP | github.com/PaoloRollo |
| 14 | **Francesco Cirulli** | GitHub `github.com/francescocirulli` | BG co-founder/PM, web3 dev | Base RPC, MCP | github (BG org) |
| 15 | **0xCaso** | GitHub `github.com/0xCaso` | BG team, 40+ web3 repos | Base RPC, MCP | github (BG org) |

### C. MCP / marketplace hubs — distribution channels (get *listed*, don't just sell)

Riding these beats building another standalone seller. Ask = "list our MCP / endpoints in your registry."

| # | Target | Reach | What it is | Ask | Source |
|---|--------|-------|-----------|-----|--------|
| 16 | **ATXP** | GitHub `github.com/atxp-dev/atxp` | One command gives an agent a Base USDC wallet + 100+ x402-paid MCP tools | Get our 11-tool MCP added to their tool set | github.com/Merit-Systems/awesome-x402 |
| 17 | **Gatefare** | GitHub `github.com/gatefareio/mcp-server` · npm `@gatefare/mcp` | Marketplace MCP server (discovery/buyer/publisher), in official MCP Registry, USDC on Base | List our endpoints as discoverable services | Merit awesome-x402 |
| 18 | **MoltPe** | GitHub `github.com/umangbuilds/moltpe-agent-payments` · `moltpe.com` | Non-custodial agent wallets, 11 MCP tools for Claude Desktop/Cursor/Windsurf, Base | Bundle our data tools into their MCP | Merit awesome-x402 |
| 19 | **Pyrimid** | `pyrimid.ai` | Agent-to-agent commerce infra, MCP-native service discovery, payment splitting | List in their service registry; they also need `/chain/tx` to verify splits | Merit awesome-x402 |
| 20 | **gold-402 / 24K Labs** | GitHub `github.com/Haustorium12/gold-402` | Curated 300+ (29k full) x402 directory with verified badges | Submit for a verified listing | Merit awesome-x402 |

### D. Adjacent / infra — softer fit, lower priority

| # | Target | Reach | What it is | Angle | Source |
|---|--------|-------|-----------|-------|--------|
| 21 | **TrustBench** | `trustbench.io` · npm `@trustbench/verify-receipt` | Non-custodial audit layer, Ed25519 receipts + on-chain settlement evidence on Base | Could consume `/chain/tx` for settlement verification | Merit awesome-x402 |
| 22 | **inference.sh** | `inference.sh/x402` | Agent platform with x402 wallet/budget infra (no named crypto agents yet) | Watch for crypto templates; low priority | inference.sh/x402 |
| 23 | **AgentLISA** | `agentlisa.ai` | Contract-security scanner; hit **#4 on x402scan** (3,578 payers, $3,100/day). *Seller, not a natural buyer* | Monitor as proof the leaderboard is a live lead-source; not an outreach target | chainwire.org/2025/11/12/agentlisa-reaches-4 |

**Live scan targets (re-check for fresh Base agent-consumers):**
- **Onyx Bazaar** — `onyx-actions.onrender.com/bazaar` (+ `/bazaar.json`), 15-min refresh, views by volume / unique-payers / recent / cheapest.
- **x402scan.com** leaderboard (JS-rendered — hit the API or browser).

---

## 2. RANKING — warmest to coldest (likelihood of first paying call)

Scored on: need for Base/crypto data × reachability × current activity.

**Tier 1 — fire first (high need + reachable + active):**
1. **Gina (askgina.eth)** — literally a wallet-balance agent; Farcaster-reachable; live product. Perfect `/chain/balance` fit.
2. **kinance** — deepest in Claude+x402 tooling → most likely to actually run the curl/MCP one-liner today. GitHub-reachable.
3. **Legasi** — small, hungry hackathon team, live site, needs `/defi/yields` + Base RPC; X + GitHub reachable.
4. **Bankr** — dual value (buyer + x402 Cloud distribution). Higher effort to reach a human, but biggest upside — prioritize the *channel* ask.
5. **CardZero** — buyer-side x402 wallet; direct gas/balance need; site + GitHub reachable.

**Tier 2 — strong, slightly harder:**
6. **Builders Garden (limone.eth / orbulo)** — small responsive studio, teaches the stack, can introduce cohort. Farcaster/X/GitHub.
7. **Bracky** — clean `/pm/markets` fit; Farcaster-native.
8. **AgentVault** — great crypto fit; verify repo is still active before firing.
9. **World of Geneva** — hackathon winner, needs chain data; confirm it's sustained past the demo.

**Tier 3 — distribution plays (channel, not per-call):**
10. **ATXP**, 11. **Gatefare**, 12. **MoltPe**, 13. **Pyrimid**, 14. **gold-402** — get listed; compounding rather than immediate.

**Tier 4 — big/hard-to-reach or soft fit:**
15. **Clanker** (acquired, big), 16. **aixbt** (famous, hard to reach a human), 17. **TrustBench**, 18. **inference.sh**. Monitor **AgentLISA** + **Onyx Bazaar** as lead sources.

---

## 3. DRAFTED OUTREACH — value-first, 1:1

### Main template (≈150 words) — DM / email

> Hey [PERSONALIZE: name] — saw [PERSONALIZE: specific thing they built, e.g. "Gina pulling wallet PnL by Farcaster handle" / "Legasi's yield-on-idle-funds credit lines"]. Nice work.
>
> Quick value-add, no ask: we run a live x402 data API on Base and the **Base-chain RPC endpoints are free to try** — most x402 data sellers are Ethereum-only, so if [PERSONALIZE: their agent] ever needs live Base gas / balance / token-balance / tx lookups, it's a drop-in.
>
> One curl:
> ```
> curl "https://x402-data-api.sigrunner.workers.dev/chain/gas-price"
> ```
> Or wire the whole thing into your agent as an MCP server:
> ```
> npx mcp-remote https://x402-data-api.sigrunner.workers.dev/mcp
> ```
> [PERSONALIZE: endpoint most relevant to them, e.g. "`/pm/markets` for the Polymarket side" / "`/defi/yields` for idle-fund routing"].
>
> Free to hammer it while you're building — paid tier is $0.001/call in USDC on Base once you're in prod. Happy to add any endpoint you're missing.
>
> — [PERSONALIZE: your name]

### Farcaster / X variant (<280 char)

> [PERSONALIZE: @handle] your [PERSONALIZE: agent] needs live Base chain data? Most x402 sellers are ETH-only — ours does Base gas/balance/tx, free to try:
> `curl x402-data-api.sigrunner.workers.dev/chain/gas-price`
> MCP: `npx mcp-remote …/mcp`. Paid tier $0.001/call USDC on Base. 🫡

### GitHub issue / discussion variant

> **Title:** Free-to-try Base-chain RPC data for [PERSONALIZE: project]
>
> Hey — really like what you're doing with [PERSONALIZE: specific feature, cite file/README line]. Noticed [PERSONALIZE: where they fetch chain/crypto data, or where they'd need it].
>
> We run an x402 data API with **Base-chain RPC endpoints** (`/chain/gas-price`, `/chain/balance`, `/chain/token-balance`, `/chain/tx`, `/chain/wallet`) — relevant because the main competitor (OneSource) is Ethereum-only. Free to try, no key:
> ```
> curl "https://x402-data-api.sigrunner.workers.dev/chain/gas-price"
> ```
> MCP server (11 tools): `npx mcp-remote https://x402-data-api.sigrunner.workers.dev/mcp`
>
> Not a PR spam — just flagging in case it saves you standing up your own Base RPC layer. Paid tier is $0.001/call in USDC on Base. Happy to add any endpoint you need. Feel free to close if not useful. 🙏

---

## 4. CHANNEL NOTES — norms so it doesn't read as spam

**Farcaster** (Gina, Bracky, Bankr, Builders Garden, Clanker)
- Highest-signal channel here — the whole agent-builder scene lives on it. **Reply/quote-cast in-thread** on something they posted before DMing; a cold DM with no prior interaction is weak.
- Cast publicly *at* the agent (many like Gina/Clanker/Bankr are literally bots you invoke in-feed) — a working demo cast (run their bot, then show your endpoint complementing it) is the native move.
- Tone: lowercase, terse, emoji ok (🫡, 🙏). No corporate voice. Devs there smell marketing instantly.
- Relevant channels: `/x402`, `/agents`, `/base`, `/devs`.

**X / Twitter** (aixbt, Legasi, Bankr, AgentVault)
- Reply to a recent build-update tweet with the curl one-liner *as a helpful add*, not a pitch. Public reply > cold DM (DMs often closed/unread).
- Keep it one tweet, one curl, one link. Screenshot of a live JSON response beats a paragraph.
- Follow first, engage on 1–2 posts, then reach out — pattern-matches to "real dev," not bot.

**GitHub** (kinance, AgentVault, Legasi, MoltPe, Gatefare, ATXP, Builders Garden repos)
- **Highest conversion for the technical crowd.** Open a *Discussion* (or Issue only if they use issues for this) — never a drive-by PR.
- Reference a specific file/line where they fetch or would need chain data → proves you read the code. Generic issues get closed.
- Offer, don't demand: "flagging in case it's useful, close if not." Include the exact install + curl so it's zero-effort to try.
- For hubs (ATXP/Gatefare/gold-402): follow their **contribution/listing process** (PR to a registry file, submission form) rather than an issue — that's the sanctioned path.

**Discord** (Base, Coinbase CDP, x402 community servers)
- Post in the right channel (`#showcase` / `#builders` / `#x402`), not `#general` or DMs. Unsolicited DMs = fastest way to get banned.
- Lead by *helping someone else's question* about Base data first; drop your endpoint as the answer. Earn the mention.
- One post, then go quiet — don't bump. Pin-worthy value (a working snippet) gets organic reshares.

**Universal rules:** (1) personalize the first line with something only-a-reader-would-know; (2) give the free thing before any mention of paid; (3) one curl + one install line, nothing more; (4) explicit "close/ignore if not useful" opt-out; (5) never send the same text to two people in the same channel — they talk.

---

*Compiled 2026-07-16. Sources cited inline. Handles verified against fetched pages where possible; re-confirm any Farcaster/X handle at send-time (they change). AgentVault + World of Geneva: verify current activity before firing.*
