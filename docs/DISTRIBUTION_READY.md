# Distribution — prepared, awaiting Rez's go (identity-gated)

Autonomous distribution is done: 4 paid shelves are live + catalogued on the CDP Bazaar
(`/discovery/merchant?payTo=0x5765…` → 4/4) and the `.well-known/x402` manifest is crawlable by
the x402 explorers. **Problem:** on the quality-sorted public catalog we're cold-start-buried
(0 organic calls → past offset 1000). Being *in* the catalog ≠ being *found*. The accelerant is
external distribution that points an agent straight at us. Those channels publish under Grey Ridge /
Rez's accounts, so they're Rez's to approve. All prepared below — **approve and Claude ships it**
(GH_TOKEN is live, verified this session).

## 1. awesome-x402 listing (xpaysh/awesome-x402, 261★) — PR, Claude executes on approval
Target section: `### Data & Social APIs` (same section as our competitors AgentData API, DevDrops,
Askew, Darrylbots). Exact entry to add:

```markdown
- [Grey Ridge Signals — Crypto & Prediction-Market Data](https://x402-data-api.sigrunner.workers.dev) — Cheap, keyless data for AI agents on Base. `GET /crypto/prices` ($0.001, DefiLlama spot prices), `GET /crypto/funding` ($0.001, Hyperliquid perp funding + annualized), `GET /defi/yields` ($0.001, DefiLlama lending/LP yields), `GET /pm/markets` ($0.005, live Polymarket prediction markets), plus `GET /scan/mcp` ($0.10, MCP-server security audit — tool-poisoning / prompt-injection, OWASP LLM01/LLM08). USDC on Base via x402, listed on the CDP Bazaar, no API keys or signup. ([Discovery](https://x402-data-api.sigrunner.workers.dev/.well-known/x402))
```

Ship sequence (Claude runs on approval): `gh repo fork xpaysh/awesome-x402 --clone` → insert line →
branch `add-grey-ridge-signals` → commit → push → `gh pr create --repo xpaysh/awesome-x402`.

## 2. Community post (X / Farcaster / relevant Discords) — Rez posts, or approve an account for Claude
Draft:
> New on the x402 Bazaar — Grey Ridge Signals: cheap, keyless data endpoints for AI agents on Base.
> Crypto spot prices · Hyperliquid funding rates · DefiLlama yields · Polymarket markets — **$0.001/call**,
> USDC via x402, no keys/signup. Discovery: https://x402-data-api.sigrunner.workers.dev/.well-known/x402

## 3. Unblock autonomous expansion — private remote for this repo (Claude executes on approval)
This repo has **no git remote**, which is why the overnight expansion loop (`ov-6edad23e71`) jams on its
"open a PR" step. History is verified secret-clean (only `.dev.vars.example` tracked). On approval:
`gh repo create rezearcher/x402-data-api --private --source=. --push`. Then overnight keeps stocking new
shelves without Rez in the loop.

## 4. Next-wave seeding capital (the only $ atom)
Buyer wallet `0xC4852c26498d3187dEc2ce1b19e840710e302d1e` is ~$0 USDC (spent $0.004 this session,
all recycled to our payTo). The next expansion wave (crypto/trending, gas, Kalshi PM, sentiment) needs
~$0.02 USDC on Base sent to that buyer to seed each new shelf (~$0.001/seed). Not needed for anything
already shipped.
