# x402 Data API — Value-First Outreach Target List

**Product:** https://x402-data-api.sigrunner.workers.dev — 15+ endpoints, agents pay per-call in USDC on Base.
**Lead-with strengths:** Base-chain RPC (`/chain/block-number`, `/chain/gas-price`, `/chain/balance`, `/chain/token-balance`, `/chain/tx`, `/chain/wallet` @ $0.001 — **Base is uncontested; competitor OneSource is Ethereum-only**), crypto (`/crypto/prices`, `/crypto/funding`), `/defi/yields`, Polymarket (`/pm/markets`), plus an 11-tool MCP server at `/mcp`.
**Compiled:** 2026-07-17. Every target below carries a source URL. **Hand to a human to fire.**

---

## 1. NAMED TARGETS (24)

### Tier A — Warmest: confirmed x402 buyers, Base/crypto data on their critical path, reachable

| # | Target | Reach | What they build | Best-fit endpoints | Source |
|---|--------|-------|-----------------|--------------------|--------|
| 1 | **Heurist Agent Framework** | GitHub `heurist-network/heurist-agent-framework` · X `@heurist_ai` · mesh.heurist.ai | Open-source multi-interface agent framework; **Heurist Mesh gives agents 30+ Web3 tools and explicitly consumes x402 pay-per-use APIs in USDC on Base** for token/on-chain data — confirmed buyer | `/crypto/prices`, `/crypto/funding`, `/chain/*`, MCP | https://github.com/heurist-network/heurist-agent-framework · https://x.com/heurist_ai/status/1989257000950038861 |
| 2 | **Bankr** | X `@bankrbot` · bankr.bot · GitHub `BankrBot/skills` | Base's own spotlighted "autonomous portfolio manager — analyzes markets, executes trades, optimizes yield across Base protocols"; runs a **plug-in Skills marketplace** third-party devs build on | `/chain/gas-price`, `/chain/balance`, `/chain/token-balance`, `/crypto/prices`, `/defi/yields` | https://www.base.org/agents · https://github.com/BankrBot/skills |
| 3 | **inference.sh** (Ömer Karışman) | GitHub `inference-sh` · X `@inference_sh` · discord.gg/inference | Agent runtime giving agents managed wallets, spend limits & **x402 autonomous payments** (built `mpp` Machine Payments Protocol middleware); 150+ tool integrations — agents already have working x402 wallets | any: `/chain/*`, `/crypto/prices`, `/defi/yields`, MCP | https://inference.sh/x402 · https://github.com/inference-sh/mpp |
| 4 | **AInalyst** | X `@AInalyst_` (Virtuals ecosystem) | AI-native on-chain analytics agent; reached **#5 x402scan server rank and #1 on the x402 Composer leaderboard** — active payer | `/crypto/prices`, `/chain/block-number`, `/chain/gas-price` | https://x.com/virtuals_io/status/1982499746972651739 |
| 5 | **AgentLISA** | agentlisa.ai | AI smart-contract security auditor (pay-per-scan); **#4 on x402scan 24h leaderboard, 3,578 paying developers, $12M raised** — confirmed x402 consumer | `/chain/tx`, `/chain/wallet`, `/chain/balance` (wallet/contract forensics feed audits) | https://chainwire.org/2025/11/12/agentlisa-reaches-4-on-x402scan-leaderboard |
| 6 | **Loomlay** | X `@loomlayai` | No-code AI agent builder w/ built-in ERC-4337 wallets + Base integration; shipped **"x402 Powered LLM Inference"** (discoverable on Bazaar & x402scan) | `/chain/*` (Base-native), MCP | https://x.com/loomlayai/status/1986946061865292092 |
| 7 | **AgentPay** (Vedant Anand) | GitHub `VedantAnand17/AgentPay` | Base agent executing autonomous Uniswap V3 spot trades via `x402-fetch`, pay-per-trade, no API keys/custody — small responsive builder, near-perfect fit | `/chain/gas-price`, `/chain/balance`, `/chain/tx`, `/crypto/prices` | https://github.com/VedantAnand17/AgentPay |

### Tier B — Strong: individual builders + infra studios, reachable, clear data need

| # | Target | Reach | What they build | Best-fit endpoints | Source |
|---|--------|-------|-----------------|--------------------|--------|
| 8 | **Builders Garden** | builders.garden · GitHub `builders-garden` · X `@builders_garden` · FC `builders-garden` | AI-native product studio; **`servex-rs` literally builds x402-monetization infra** (Rust proxy, USDC on Base, CDP facilitator), plus `SIWA` (agent auth) & `Majordomo` (agent discovery). Co-host of the Farcaster Agentic Bootcamp | MCP, `/chain/*` | https://builders.garden · https://github.com/builders-garden/servex-rs |
| 9 | **Apify** (Saurav Jain `@Sauain`, Štěpán Škopek) | docs.apify.com/platform/integrations/x402 · GitHub `apify` · X `@apify` · discord.gg/jyEM2PRvMU | **20,000+ Actors now payable via x402 in USDC on Base** (Coinbase partnership, added x402 to `mcpc` MCP CLI); agents already wired — cross-sell cheap Base RPC | `/chain/*`, `/crypto/prices` | https://blog.apify.com/introducing-x402-agentic-payments/ · https://x.com/Sauain/status/2071978177145221142 |
| 10 | **ProtoJay4789 / GenTech Labs** | GitHub `BankrBot/skills` PRs · glama.ai/mcp/servers/ProtoJay4789 | Built "GenTech Agent Kit" MCP server (real-time market data, DeFi intel, x402 micropayments) as a Bankr skill — direct analog, would trial our data | `/crypto/prices`, `/defi/yields`, `/chain/gas-price` | https://glama.ai/mcp/servers/ProtoJay4789/genTech-agent-kit |
| 11 | **PhantomCapAI** | GitHub `BankrBot/skills` PRs | Built "polyrobin" (Polymarket) skill for Bankr — exact `/pm/markets` consumer | `/pm/markets` | https://github.com/BankrBot/skills/pulls |
| 12 | **Legasi** | evm.legasi.io · DoraHacks `buidl/39347` | Agentic credit/lending protocol — agents borrow USDC, pay via x402, earn yield on idle funds, build on-chain reputation (2nd place SF x402 Hackathon) | `/chain/wallet`, `/chain/balance`, `/chain/token-balance`, `/defi/yields` | https://www.skale.space/blog/san-francisco-agentic-commerce-x402-hackathon-recap-winners |
| 13 | **Gatefare** | GitHub `gatefareio/mcp-server` | Marketplace MCP server for paid HTTP APIs w/ discovery + auto-payment — buyer-side agents use it to find & pay for APIs like ours; **list here to be discovered** | MCP listing, `/chain/*` | https://github.com/gatefareio/mcp-server |
| 14 | **ATXP** | GitHub `atxp-dev/atxp` | Registers agents w/ USDC wallet + inbox + 100+ x402-paid MCP tools — add our MCP as a listed tool | MCP | https://github.com/atxp-dev/atxp |
| 15 | **Neynar** | dev.neynar.com · neynar.com/slack · GitHub `neynarxyz` · X `@neynarxyz` | Farcaster's main API/dev-tools provider; **shipped x402 (agents pay-per-request in USDC for social-graph data)** — their agent devs also need Base reads | MCP, `/chain/*` | https://neynar.com/blog/agents-frames-and-the-future-of-farcaster-neynar-s-vision-for-x402 |

### Tier C — Distribution surfaces & frameworks: list our API here to reach many agents at once

| # | Target | Reach | What they build | Best-fit endpoints | Source |
|---|--------|-------|-----------------|--------------------|--------|
| 16 | **x402scan Composer / Merit Systems** | x402scan.com/composer · GitHub `Merit-Systems` | "ChatGPT-like agent builder" where user-built agents call all indexed x402 resources — **listing exposes our API to every Composer agent** | MCP (distribution) | https://x402scan.com/composer |
| 17 | **AIsa** | aisa.one | "Capability layer for the agentic economy" — resource/transaction layer where agents discover & pay for APIs ($6.5M raise, Alibaba/Tribe) — both buyer network and listing surface | MCP, `/crypto/*`, `/defi/yields` | https://aisa.one/news/aisa-raises-6-5m-ai-agent-resource-network |
| 18 | **kinance** | GitHub `kinance/x402-anthropic-python` · `kinance/x402-anthropic-typescript` | Drop-in Anthropic SDK wrappers that auto-handle x402 payment retry — **any Claude agent using these is an x402 buyer by default** (high relevance to our MCP/Claude framing) | MCP | https://github.com/kinance/x402-anthropic-python |
| 19 | **krystiangw / agenticpay** | GitHub `krystiangw/agenticpay` | Open-source TS x402 stack (CLI, middleware, facilitator) for MCP-based agent payments | `/chain/*`, MCP | https://github.com/krystiangw/agenticpay |
| 20 | **nikoSchoinas / routeweiler** | GitHub `nikoSchoinas/routeweiler-python-sdk` | Python micropayment client for autonomous agents, auto-handles HTTP 402 | `/crypto/prices`, `/pm/markets` | https://github.com/nikoSchoinas/routeweiler-python-sdk |
| 21 | **Warden Protocol** | GitHub `warden-protocol/agent-kit` | Agent-kit for building on-chain agents (P2P inference, 60M+ agentic tasks) — their community devs bolt on data tools | MCP | https://github.com/warden-protocol/agent-kit |
| 22 | **Virtuals Protocol** | GitHub `Virtual-Protocol/virtuals-python` · X `@virtuals_io` | AI-agent launchpad/tokenization on Base (agents Luna, Aethernet, AInalyst) — broad ecosystem of token-agents tracking treasuries/prices | `/crypto/prices`, `/chain/wallet` | https://github.com/Virtual-Protocol/virtuals-python |
| 23 | **Nader Dabit (`dabit3`)** | GitHub `dabit3/x402-starter-kit` · X `@dabit3` | Widely-followed dev educator; x402 Starter Kit is a reference scaffold many agent builders fork — **awareness/amplification play, not a direct buyer** | Distribution/awareness | https://github.com/dabit3/x402-starter-kit |
| 24 | **Dev3Pack + FarHack** | dev3pack.xyz · X `@dev3pack` · GitHub `farhackxyz/farhack` | Web3/AI hackathon orgs (3,000+ builders) that ran the Farcaster Agentic Bootcamp → FarHack Online 2026 — **sponsor/data-partner angle to reach a whole cohort** | MCP (sponsor cohort) | https://dev3pack.xyz · https://github.com/farhackxyz/farhack |

### Monitor / mine — not 1:1 outreach targets
- **AgentZone** (agentzone.fun) — discovery/reputation explorer indexing **37,000+ agents on Base/Arbitrum by ERC-8004 + x402 payment history**. Use as a **hit-list source**: filter for active Base payers and pull individual agent operators. https://agentzone.fun
- **World of Geneva** — 1st-place SF x402 Hackathon (autonomous MMORPG, agents transact on-chain); no public handle found — track for a contact.
- **Bankr skill authors** `nato-san` (Crypto Safety Checker → `/crypto/prices`), `0xleventis` (Fish prediction market → `/pm/markets`), `Gitlawb` (agent coding platform, `hey@gitlawb.com`) — thin individual leads, batch-reach via the Bankr repo.

> **⚑ FLAG FOR REZ (not a cold target):** a PR author `rezearcher` submitted a skill named **`grey-ridge-x402`** to `github.com/BankrBot/skills`. That looks like our own brand — likely prior/parallel work. Verify directly before treating anything in that repo as untouched territory. https://github.com/BankrBot/skills/pulls

---

## 2. RANKING (warmest → coldest to first paying call)

**Fire in this order.** Ranked on: (a) confirmed/near-certain x402 spend, (b) Base-chain data actually on their critical path, (c) reachability, (d) activity/recency.

1. **Heurist Agent Framework** — confirmed x402 buyer on Base, open GitHub, 30+ tool slots to add ours. The single warmest lead.
2. **Bankr** — Base's flagship agent + an open Skills marketplace = a *channel*, not just one customer. `@bankrbot` public.
3. **inference.sh** — agents already hold working x402 wallets; Discord + GitHub open; wants more data sources.
4. **AInalyst** — proven top-of-leaderboard payer; analytics agent literally needs price/chain data; X-reachable.
5. **AgentLISA** — funded, 3.5k paying devs, x402-native; wallet/tx forensics is a clean fit.
6. **AgentPay (VedantAnand17)** — tiny Base-trading builder, most likely to reply fast and wire a call same-day.
7. **Loomlay** — Base-native no-code builder shipping x402; X-reachable.
8. **ProtoJay4789 / GenTech** — building the exact market-data MCP we sell; convert or partner.
9. **PhantomCapAI** — Polymarket skill author; `/pm/markets` is a bullseye.
10. **Builders Garden** — builds x402 infra; more of a partner/amplifier than buyer, but deeply networked.
11. **Apify** — huge surface; slower (org, not solo) but `@Sauain` is a reachable human who publicized x402.
12. **Gatefare** / 13. **ATXP** / 16. **x402scan Composer** / 17. **AIsa** — *listing surfaces*: one integration → many downstream agents. Highest leverage, lower urgency.
14. **Legasi** — needs wallet/balance/yields; hackathon-stage, may be pre-revenue.
15. **Neynar** — partner/community angle; their devs need Base reads.
16–24. **kinance, agenticpay, routeweiler, Warden, Virtuals, Nader Dabit, Dev3Pack/FarHack** — framework/distribution & awareness plays; batch or sponsor, not hot 1:1.

**Highest-leverage single move:** get listed on **x402scan Composer / a marketplace MCP (Gatefare, ATXP)** *and* land **Heurist + Bankr** directly. That's "discovered by many" + two named logos.

---

## 3. DRAFTED OUTREACH MESSAGES

### A. Primary 1:1 (email / DM / long-form) — ~150 words

> Hey [PERSONALIZE: name] — saw [PERSONALIZE: specific repo/cast/product, e.g. "servex-rs" / "your Composer agent AInalyst"] and that you're building agents that [PERSONALIZE: pay per-call via x402 / trade on Base / audit contracts].
>
> We run a live x402 data API on Base that might drop a hop out of your stack. The **Base-chain RPC** endpoints — block number, gas price, wallet + token balances, tx status — are **$0.001/call**, and unlike OneSource (Ethereum-only) they actually cover **Base**. Crypto prices, cross-venue funding, DeFi yields and Polymarket markets are there too.
>
> **Free to try, no key.** MCP install (one line):
> `add https://x402-data-api.sigrunner.workers.dev/mcp` to your MCP client
>
> One curl:
> `curl https://x402-data-api.sigrunner.workers.dev/chain/gas-price`
>
> Paid tier is pay-per-call in USDC on Base via x402 once you're past kicking tires. If Base gas/balance/price data is on your agent's critical path, I'll wire you free calls — just want your feedback. — [PERSONALIZE: your name]

### B. Farcaster / X variant — <280 chars

> @[PERSONALIZE: handle] building [PERSONALIZE: thing] on Base? Our x402 API has Base RPC (gas/balances/tx) + crypto prices + Polymarket. $0.001/call, free to try, no key, Base-native (not ETH-only). MCP: sigrunner.workers.dev/mcp · `curl /chain/gas-price`. Want me to wire you free calls?

### C. GitHub issue / discussion variant

> **Title:** Base-chain data endpoints for [PERSONALIZE: project] agents — x402, free to try
>
> Hi — really like what you're doing with [PERSONALIZE: specific feature/file, e.g. "the x402 payment retry in your Anthropic wrapper"]. Sharing in case it's useful, not selling:
>
> We run an x402 data API on Base with cheap Base-chain RPC (`/chain/gas-price`, `/chain/balance`, `/chain/token-balance`, `/chain/tx`, `/chain/wallet` @ $0.001/call), plus `/crypto/prices`, `/crypto/funding`, `/defi/yields`, `/pm/markets`. Notably **Base-native** — the main competitor (OneSource) is Ethereum-only.
>
> Free to try, no key:
> ```
> curl https://x402-data-api.sigrunner.workers.dev/chain/gas-price
> ```
> There's an 11-tool MCP server at `/mcp` if you'd rather wire it as agent tools. Paid usage is pay-per-call in USDC on Base via x402. Happy to open free access for [PERSONALIZE: project] and take any feedback — would a Base RPC / price feed fit [PERSONALIZE: their use case]?

**[PERSONALIZE] slots to fill every time:** (1) their name/handle, (2) the *specific* repo/cast/product you looked at, (3) what their agent does, (4) which one endpoint maps to their exact need.

---

## 4. CHANNEL NOTES — how to not read as spam

**Farcaster** — The most forgiving dev channel *if* you engage first. Reply to or quote-cast their actual build before pitching; don't cold-DM a link. Post value in relevant channels (`/x402`, `/agents`, `/base`, `/dev`) rather than blasting. One genuine, specific reply > ten DMs. Warpcast culture rewards builders who ship and show; lead with a working curl, not a sales line. Frames/mini-apps land better than plain links.

**X** — Reply-guy, don't DM-guy. Comment usefully on their x402/agent posts first so your handle is familiar before any ask. Keep the pitch to one tweet, one link, one concrete number ($0.001, Base-native). Threads with a live curl/screenshot outperform DMs. Avoid identical copy-paste across accounts — X flags it and devs screenshot it.

**GitHub** — The highest-signal, lowest-tolerance-for-noise channel. Only open an issue/discussion if it's genuinely relevant to *their* repo, and reference a specific file/line. Never open an issue that's purely promotional (fast way to get blocked). Better paths: a Discussion (not an Issue), a helpful PR/comment, or their listed contact email. If they have a `skills`/plugin registry (Bankr, Apify, Heurist Mesh), the *right* move is contributing a working integration, not filing a pitch.

**Discord** — Post in the designated `#show-and-tell` / `#projects` / `#integrations` channel, never `#general` or DMs (DMs from non-members = instant spam read). Introduce yourself, share the endpoint + curl, ask for feedback. Answer someone's data question with your endpoint as the answer — that's the native-feeling move. Read pinned rules first; some servers require intro-channel posts before you can share links.

---

*Accuracy caveat: handles/URLs verified via web search on 2026-07-17. Confirm each handle is live before firing. World of Geneva has no contact yet; Bankr-skill individual authors are thin leads best batched.*
