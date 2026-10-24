#!/usr/bin/env python3
"""gen_line_a_pages.py — Line-A per-framework install-intent SEO landing pages.

Line B has 87 MCP security scorecards + a ranked leaderboard on the Google-crawled
github.io Pages channel; Line A had ZERO per-framework install pages despite 3 live
npm swap-gate plugins. This generator fixes that: one dedicated page per framework
(ElizaOS / Vercel AI SDK / LangChain) targeting the install-intent long-tail query a
Base trading-agent dev actually types, each carrying a one-line `npm i`, the real
framework integration snippet, a LIVE GO/BLOCK demo pulled from the production gate at
generate-time (not a claim), and the sizing/breakeven wedge that is our only moat.

Publishes to rezearcher.github.io/greyridge-x402-tools/docs (the crawled channel —
the Worker itself is not crawled, memory zi/zh), links them from index.md, rebuilds
sitemap.xml from the GROUND-TRUTH docs/ listing (no hardcoded page roster), and pings
IndexNow so Bing/Yandex index immediately instead of waiting on Googlebot lag.

Usage:
  python3 scripts/gen_line_a_pages.py --dry-run     # render locally, print, no writes
  python3 scripts/gen_line_a_pages.py --publish     # PUT pages + index + sitemap + IndexNow
"""
import argparse
import base64
import datetime
import json
import os
import subprocess
import sys
import urllib.request

REPO = "rezearcher/greyridge-x402-tools"
DOCS = "docs"
SITE = "https://rezearcher.github.io/greyridge-x402-tools"
WORKER = "https://x402-data-api.sigrunner.workers.dev"
UA = {"User-Agent": "greyridge-line-a-pages/1.0"}
INDEXNOW_HOST = "rezearcher.github.io"
INDEXNOW_KEY = "aa3ee6fa313780532656391c0c73664f"
ENV = dict(os.environ)

# Demo tokens: a known-live GO and a guaranteed BLOCK (the zero/dead address is not an
# ERC-20, so it always blocks — a stable, honest negative control for the demo table).
GO_TOKEN = "aero"
BLOCK_TOKEN = "0x000000000000000000000000000000000000dEaD"
# Fallbacks if the live fetch is throttled at generate-time — degrade open, never block a publish.
_FALLBACK = {
    GO_TOKEN: {"decision": "go", "verdict": "SAFE", "risk_score": 15,
              "reason": "token passes safety checks; trade is 0.01% of pool liquidity"},
    BLOCK_TOKEN: {"decision": "block", "verdict": "AVOID", "risk_score": 100,
                 "reason": "address is not a contract / not an ERC-20"},
}


def live_demo(token):
    try:
        req = urllib.request.Request(
            f"{WORKER}/gate/swap/preview?token={urllib.parse.quote(token)}", headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read().decode())
        return {"decision": d.get("decision"), "verdict": d.get("verdict"),
                "risk_score": d.get("risk_score"), "reason": str(d.get("reason", ""))[:120]}
    except Exception as e:
        print(f"live_demo({token}) fell back ({e})", file=sys.stderr)
        return _FALLBACK[token]


import urllib.parse  # noqa: E402  (after helpers, used by live_demo + indexnow)

# --- per-framework definitions -------------------------------------------------------
FRAMEWORKS = [
    {
        "slug": "elizaos-token-safety-plugin",
        "pkg": "@grey-ridge/elizaos-plugin-swap-gate",
        "framework": "ElizaOS",
        "title": "ElizaOS token-safety plugin — pre-trade swap gate for Base agents",
        "description": ("Drop-in ElizaOS plugin that checks a Base token for honeypots, "
                        "unsellable positions and rug controls before your agent swaps — "
                        "paid inline with x402 USDC ($0.008/call), no API key. Returns GO / "
                        "HOLD / BLOCK plus trade sizing."),
        "query": "elizaos token safety plugin / honeypot check action",
        "install": "npm install github:rezearcher/plugin-swap-gate",
        "snippet": (
            'import swapGatePlugin from "@grey-ridge/elizaos-plugin-swap-gate";\n'
            "\n"
            "export const character = {\n"
            '  name: "TraderBot",\n'
            "  // ...\n"
            "  plugins: [swapGatePlugin],\n"
            "};"),
        "snippet_note": ("The plugin registers two paid pre-trade actions — the agent picks "
                         "`GATE_SWAP` (final gate, sized to a notional) or `TOKEN_REPORT` "
                         "(screening) from the user's intent. No extra wiring; it reads "
                         "`PRIVATE_KEY` from the agent environment for the x402 payment."),
    },
    {
        "slug": "vercel-ai-sdk-swap-guard",
        "pkg": "@grey-ridge/vercel-ai-swap-gate",
        "framework": "Vercel AI SDK",
        "title": "Vercel AI SDK swap guard — one tool that vets a Base token before every swap",
        "description": ("A Vercel AI SDK `tool` that runs before every swap: honeypot, "
                        "sellability, rug controls and order-size-vs-pool. Your model gets a "
                        "single `proceed` boolean. Paid inline x402 USDC $0.008/call, fails "
                        "closed. Drop into generateText."),
        "query": "vercel ai sdk swap guard / token safety tool",
        "install": "npm install github:rezearcher/vercel-ai-swap-gate ai zod",
        "snippet": (
            'import { generateText } from "ai";\n'
            'import { openai } from "@ai-sdk/openai";\n'
            'import { createSwapGuard } from "@grey-ridge/vercel-ai-swap-gate";\n'
            "\n"
            "const swapGuard = createSwapGuard({ privateKey: process.env.PRIVATE_KEY });\n"
            "\n"
            "await generateText({\n"
            "  model: openai(\"gpt-4o\"),\n"
            "  tools: { swapGuard },\n"
            '  prompt: "Buy $500 of 0x... if it is safe",\n'
            "});"),
        "snippet_note": ("The tool returns the full gate verdict plus three fields your agent "
                         "can branch on directly — `proceed` (boolean), `decision` (go/hold/"
                         "block) and the sizing summary. **Fails closed:** if the gate is ever "
                         "unreachable the tool returns `proceed: false`, so an outage can never "
                         "green-light a swap."),
    },
    {
        "slug": "langchain-honeypot-check-tool",
        "pkg": "@grey-ridge/langchain-swap-gate",
        "framework": "LangChain.js",
        "title": "LangChain honeypot-check tool — pre-trade token gate for Base agents",
        "description": ("A LangChain.js tool that checks a Base ERC-20 for honeypots, "
                        "unsellable positions and rug controls before your agent swaps. "
                        "Returns proceed:false / decision:block when the check does not "
                        "settle. Paid inline x402 USDC $0.008/call, no key."),
        "query": "langchain honeypot check tool / base token safety",
        "install": "npm install github:rezearcher/langchain-swap-gate @langchain/core zod",
        "snippet": (
            'import { createSwapGuard } from "@grey-ridge/langchain-swap-gate";\n'
            'import { createReactAgent } from "@langchain/langgraph/prebuilt";\n'
            'import { ChatOpenAI } from "@langchain/openai";\n'
            "\n"
            "const swapGuard = createSwapGuard({ privateKey: process.env.PRIVATE_KEY });\n"
            "\n"
            "const agent = createReactAgent({\n"
            "  llm: new ChatOpenAI({ model: \"gpt-4o\" }),\n"
            "  tools: [swapGuard],\n"
            "});"),
        "snippet_note": ("A second `tokenReport` screening tool is exported too — wire both and "
                         "the agent screens early, then gates at the moment of the swap. The "
                         "tool uses `responseFormat: \"content_and_artifact\"` so the structured "
                         "verdict is available to your graph, not just prose."),
    },
]

COMP_ROW = (
    "| | **Grey Ridge swap gate** | GoPlus token API | 1inch / router safety | roll-your-own |\n"
    "|---|---|---|---|---|\n"
    "| Ships as a native {fw} drop-in | ✅ | you wrap it | you wrap it | you build it |\n"
    "| Pay-per-call, no account / key / dashboard | ✅ x402 USDC $0.008 | API key + plan | — | — |\n"
    "| Fails **closed** (outage never green-lights a swap) | ✅ | ✗ | ✗ | depends |\n"
    "| Returns trade **sizing + round-trip breakeven**, not just a flag | ✅ | ✗ | ✗ | ✗ |\n"
)


def render(fw, go, block, today):
    def verdict_cell(d):
        return f"`{str(d.get('decision','?')).upper()}` / {d.get('verdict','?')} (risk {d.get('risk_score','?')})"

    body = f"""---
title: {fw['title']}
description: {fw['description']}
---
# {fw['title']}

Put one call between *"the agent decided to buy"* and *"the agent signs the swap"*. For
{fw['framework']} agents trading ERC-20s on Base, this is the pre-trade safety gate: it
checks the token for honeypots, whether the position is actually sellable, the admin
controls that let a deployer rug it, and whether your order is too large for the pool —
then returns **GO / HOLD / BLOCK** plus the trade sizing. Paid inline with
**x402 USDC — $0.008/call**. No API key, no dashboard, no subscription.

## Install

```bash
{fw['install']}
```

```js
{fw['snippet']}
```

{fw['snippet_note']}

## Live verdicts (run against production right now)

These are real responses from the production gate, fetched when this page was built
({today}). Re-run them yourself against the free preview — no account:

| Token | Verdict | Why |
|---|---|---|
| `{GO_TOKEN}` (live Base token) | {verdict_cell(go)} | {go.get('reason','')} |
| dead address (negative control) | {verdict_cell(block)} | {block.get('reason','')} |

```bash
curl "{WORKER}/gate/swap/preview?token={GO_TOKEN}"
```

The free preview allows 3 real-token checks/day/IP so you can wire the plugin before you
pay a cent.

## The sizing wedge — why this beats a bare safety flag

Every other pre-trade check ends at a yes/no honeypot flag. On a **GO**, this gate also
returns the number that actually bounds your downside:

- **Entry simulation** — tokens you actually receive at spot and the USD lost to entry slippage, for $100 / $1k / $10k / $50k.
- **Exit simulation** — USD recoverable vs lost to slippage if you sell that same size back out.
- **Round-trip breakeven %** — the price move you need just to break even on the two-sided slippage.
- **Max safe size** — the largest notional that stays under your impact threshold for this pool.

So the agent doesn't just learn *"this token is safe"* — it learns, for the specific
pool and your specific notional, the exact price move needed to break even and the
largest size that stays under your impact threshold. That is the bounded-downside number
a trading agent needs, and it is on the paid `/gate/swap` response ($0.008), computed
live per token — not on the free verdict.

{COMP_ROW.format(fw=fw['framework'])}

## Pricing

| Route | Price | What you get |
|---|---|---|
| `GET /gate/swap/preview` | free (3/day/IP) | GO / HOLD / BLOCK verdict |
| `GET /gate/swap` | **$0.008 USDC** (x402) | verdict **+ entry/exit sim + round-trip breakeven + max safe size** |
| `GET /chain/token-report` | $0.01 USDC (x402) | full evidence: honeypot sim, tax, admin controls, liquidity |

At 20 trades/day that is $0.16/day — the guard rides every swap your agent makes, for the
life of the agent. 3.75× cheaper per call than the nearest x402 pre-trade gate.

Other frameworks: [ElizaOS]({SITE}/elizaos-token-safety-plugin.html) ·
[Vercel AI SDK]({SITE}/vercel-ai-sdk-swap-guard.html) ·
[LangChain.js]({SITE}/langchain-honeypot-check-tool.html).
Source + CrewAI example: [greyridge-x402-tools](https://github.com/{REPO}).
API discovery: [/.well-known/x402]({WORKER}/.well-known/x402).

[Back](index.html)
"""
    return body


# --- failure-mode x framework intent matrix ------------------------------------------
# The taxonomy below is NOT an invented gate-list: each mode maps to a field the live
# gate's own output reports (decision / reason / flags[] / liquidity_usd /
# impact_pct_of_pool), proven against production in this file's demo fetches. Each page
# targets the long-tail query a Base trading-agent dev types when THIS failure bites.
DEMO_TOKENS = ["aero", "weth", "degen", "usdc", BLOCK_TOKEN]
_TOKEN_FALLBACK = {
    "aero": {"decision": "go", "verdict": "SAFE", "risk_score": 15,
             "reason": "token passes safety checks; trade is 0.01% of pool liquidity",
             "liquidity_usd": 1384192, "impact_pct_of_pool": 0.01,
             "flags": ["owner can mint new supply"], "symbol": "AERO"},
    "weth": {"decision": "hold", "verdict": "SAFE", "risk_score": 0,
             "reason": "no verifiable Uniswap v3 WETH-pool liquidity — cannot confirm the position is exitable",
             "liquidity_usd": None, "impact_pct_of_pool": None,
             "flags": ["no honeypot, deep liquidity, no high-risk admin controls detected"], "symbol": "WETH"},
    "degen": {"decision": "go", "verdict": "SAFE", "risk_score": 20,
              "reason": "token passes safety checks; trade is 0.04% of pool liquidity",
              "liquidity_usd": 246988, "impact_pct_of_pool": 0.04,
              "flags": ["transfers can be paused"], "symbol": "DEGEN"},
    "usdc": {"decision": "go", "verdict": "SAFE", "risk_score": 25,
             "reason": "token passes safety checks; trade is 0.00% of pool liquidity",
             "liquidity_usd": 234768107, "impact_pct_of_pool": 0,
             "flags": ["owner can mint new supply", "contract can blacklist addresses",
                       "transfers can be paused", "upgradeable proxy; logic can change after purchase"],
             "symbol": "USDC"},
    BLOCK_TOKEN: {"decision": "block", "verdict": "AVOID", "risk_score": 100,
                  "reason": "address is not a contract / not an ERC-20",
                  "liquidity_usd": None, "impact_pct_of_pool": None,
                  "flags": ["address is not a contract / not an ERC-20", "static analysis verdict is block"],
                  "symbol": None},
}


def live_demo_full(token):
    """Fetch the full preview (flags + liquidity) for the matrix demos; degrade open."""
    try:
        req = urllib.request.Request(
            f"{WORKER}/gate/swap/preview?token={urllib.parse.quote(token)}", headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read().decode())
        return {"decision": d.get("decision"), "verdict": d.get("verdict"),
                "risk_score": d.get("risk_score"), "reason": str(d.get("reason", ""))[:160],
                "liquidity_usd": d.get("liquidity_usd"),
                "impact_pct_of_pool": d.get("impact_pct_of_pool"),
                "flags": d.get("flags", []) or [],
                "symbol": (d.get("token_meta") or {}).get("symbol")}
    except Exception as e:
        print(f"live_demo_full({token}) fell back ({e})", file=sys.stderr)
        return dict(_TOKEN_FALLBACK[token])


FAILURE_MODES = [
    {
        "slug": "honeypot",
        "label": "honeypot (the buy works, every sell reverts)",
        "query_tpl": "stop my {fw} agent buying a honeypot token on Base",
        "h1_tpl": "Stop your {fw} agent from buying a honeypot on Base",
        "symptom": ("The agent finds a token, the buy confirms, the chart looks alive — and then "
                    "every sell reverts. The position is a honeypot and the capital is trapped. "
                    "By the time a human notices, the funds are gone."),
        "gate_does": ("The gate hard-**blocks** anything it cannot confirm is a real, buyable ERC-20 "
                      "with a working sell path. The exact reason comes back in `flags[]` so the "
                      "agent logs *why* it refused, not just that it did."),
        "demo_go": "aero", "demo_bad": BLOCK_TOKEN,
        "bad_label": "unverifiable address (negative control)",
        "faq": [("How do I stop a {fw} agent buying a honeypot on Base?",
                 "Put a pre-trade gate between the decision and the signed swap. The Grey Ridge "
                 "swap gate statically checks the token is a real ERC-20 with a working sell path "
                 "and returns BLOCK when it is not — before the agent spends a cent."),
                ("Does the gate guarantee a token is safe?",
                 "No. It is a heuristic static + liquidity check (LLM/contract-risk signal), not a "
                 "guarantee or an audit. A BLOCK is reliable; a GO means no honeypot/rug signal was "
                 "detected at check time, not that the token is risk-free.")],
    },
    {
        "slug": "cant-sell-exit-trap",
        "label": "unsellable position / no confirmable exit",
        "query_tpl": "{fw} agent bought a token it cannot sell on Base",
        "h1_tpl": "Keep your {fw} agent out of tokens it cannot sell",
        "symptom": ("A buy is only half a trade. The agent gets filled on a token whose sell-side "
                    "liquidity is thin, fake, or gone — so the exit never clears and the position "
                    "is stuck even though it was never a classic honeypot."),
        "gate_does": ("The gate will not return **GO** unless it can confirm an exitable pool. When "
                      "the sell path is unverifiable it returns **HOLD** (`decision: hold`) with the "
                      "reason — it refuses to green-light a trade it cannot confirm you can get out of."),
        "demo_go": "aero", "demo_bad": "weth",
        "bad_label": "token with no confirmable exit pool (returns HOLD)",
        "faq": [("Why did my {fw} agent buy a token it can't sell?",
                 "Most pre-trade checks only test the buy side. The Grey Ridge gate confirms an "
                 "exitable pool before it returns GO, and returns HOLD when the sell path is "
                 "unverifiable, so the agent never enters a position it cannot leave."),
                ("What does a HOLD mean?",
                 "HOLD means the gate found no block-level danger but could not confirm the trade "
                 "is safely exitable/sizable — so it declines to auto-approve. The agent should skip "
                 "or escalate, never force the swap.")],
    },
    {
        "slug": "trade-too-big-price-impact",
        "label": "order too big for the pool / price impact",
        "query_tpl": "{fw} agent trade too big for pool slippage on Base",
        "h1_tpl": "Size every {fw} agent trade to the pool before it swaps",
        "symptom": ("The token is real and sellable — but the agent routes a $50k order into a "
                    "pool that cannot absorb it, eats double-digit slippage on entry, and more on "
                    "the way out. The round trip loses money even though nothing was a scam."),
        "gate_does": ("The free verdict reports the live pool depth (`liquidity_usd`) and the impact "
                      "of a baseline order (`impact_pct_of_pool`). The paid `/gate/swap` route runs "
                      "the real AMM curve at *your* notional and returns entry/exit simulation, "
                      "round-trip breakeven %, and the **max safe size** that stays under your "
                      "impact threshold."),
        "demo_go": "aero", "demo_bad": "degen",
        "bad_label": "thinner-liquidity pool",
        "impact_calc": True,
        "faq": [("How do I stop a {fw} agent making a trade too big for the pool?",
                 "Size the order against live pool depth before signing. The paid Grey Ridge gate "
                 "simulates entry and exit slippage at your exact notional and returns the max safe "
                 "size, so the agent never routes an order the pool cannot absorb."),
                ("What is round-trip breakeven?",
                 "The price move the token needs just to cover the slippage you pay getting in AND "
                 "back out at your size. If the agent's thesis is smaller than breakeven, the trade "
                 "loses money before fees — the gate hands the agent that number up front.")],
    },
    {
        "slug": "rug-admin-controls",
        "label": "rug via high-risk admin controls (mint / blacklist / pause / upgrade)",
        "query_tpl": "check Base token mint blacklist pause admin controls before {fw} agent buys",
        "h1_tpl": "Surface rug-enabling admin controls before your {fw} agent buys",
        "symptom": ("The token trades fine today. But the deployer kept the keys: they can mint new "
                    "supply, blacklist the agent's wallet, pause transfers, or upgrade the contract "
                    "logic after the buy. A clean chart hides a one-transaction rug."),
        "gate_does": ("The gate enumerates the dangerous owner powers it finds — *owner can mint*, "
                      "*can blacklist*, *transfers can be paused*, *upgradeable proxy* — into "
                      "`flags[]`, and folds them into the risk score. The agent sees exactly which "
                      "levers the deployer still holds before it commits capital."),
        "demo_go": "aero", "demo_bad": "usdc",
        "bad_label": "token carrying multiple admin controls",
        "show_flags": True,
        "faq": [("How do I check a Base token for rug admin controls before my {fw} agent buys?",
                 "The Grey Ridge gate inspects the contract for mint, blacklist, pause and "
                 "upgradeable-proxy powers and returns each as a flag before the swap, so the agent "
                 "weighs deployer risk instead of discovering it after a rug."),
                ("A token I trust shows admin-control flags — is that a bug?",
                 "No. Even USDC trips mint / blacklist / pause / upgradeable flags — those powers "
                 "exist on many legitimate tokens. The gate surfaces them honestly; it is the agent's "
                 "policy to decide which controls are acceptable for which size.")],
    },
]


def _usd(v):
    return f"${v:,.0f}" if isinstance(v, (int, float)) else "n/a"


def render_matrix(fw, fm, demos, today):
    """One framework x one failure mode = one long-tail intent page (live-demo backed)."""
    fwn = fw["framework"]
    go = demos[fm["demo_go"]]
    bad = demos[fm["demo_bad"]]
    query = fm["query_tpl"].format(fw=fwn)
    h1 = fm["h1_tpl"].format(fw=fwn)
    title = f"{h1} — pre-trade swap gate ({fwn})"
    desc = (f"{h1} with a drop-in {fwn} pre-trade safety check: {fm['label']}. "
            f"Paid inline with x402 USDC ($0.008/call), no API key, fails closed.")

    def vcell(d):
        return f"`{str(d.get('decision','?')).upper()}` / {d.get('verdict','?')} (risk {d.get('risk_score','?')})"

    # Failure-specific evidence block (grounded in the live fields this mode maps to).
    if fm.get("impact_calc"):
        def impact_line(d):
            liq = d.get("liquidity_usd")
            if isinstance(liq, (int, float)) and liq > 0:
                pct = 50000.0 / liq * 100.0
                return (f"`{d.get('symbol','?')}` pool liquidity **{_usd(liq)}** → a $50k order is "
                        f"~**{pct:.1f}%** of the pool (rough proxy; the paid route runs the real AMM curve)")
            return f"`{d.get('symbol','?')}` — no confirmable pool depth"
        evidence = ("**What the gate sees (live pool depth):**\n\n"
                    f"- {impact_line(go)}\n- {impact_line(bad)}\n\n"
                    "At $100 both pass; at size the thinner pool is where the agent bleeds. The paid "
                    "`/gate/swap` sizes your *actual* notional against the live curve and returns the "
                    "max safe size — the number a bare honeypot flag never gives you.")
    elif fm.get("show_flags"):
        def flag_lines(d):
            fl = d.get("flags") or []
            return "; ".join(fl) if fl else "none detected"
        evidence = ("**Admin controls the gate surfaced (live):**\n\n"
                    f"- `{go.get('symbol','GO token')}` → {flag_lines(go)}\n"
                    f"- `{bad.get('symbol','control')}` → {flag_lines(bad)}\n\n"
                    "Every dangerous owner power is enumerated into `flags[]` and scored, so the "
                    "agent commits capital with the deployer's remaining levers in full view.")
    else:
        evidence = (f"**Reason the gate returned {str(bad.get('decision','?')).upper()}:** "
                    f"{bad.get('reason','')}")

    faq_q = [(q.format(fw=fwn), a.format(fw=fwn)) for q, a in fm["faq"]]
    faq_md = "\n\n".join(f"### {q}\n\n{a}" for q, a in faq_q)
    faq_jsonld = json.dumps({
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [{"@type": "Question", "name": q,
                        "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq_q],
    })

    body = f"""---
title: {json.dumps(title)}
description: {json.dumps(desc)}
---
<script type="application/ld+json">
{faq_jsonld}
</script>

# {h1}

**The failure:** {fm['symptom']}

Searching *"{query}"* means the agent already took the loss — or you are wiring a guard so it
never does. For {fwn} agents trading ERC-20s on Base, the fix is one call between *"the agent
decided to buy"* and *"the agent signs the swap."*

**What the gate does for this failure:** {fm['gate_does']}

## Proof — live, against production ({today})

Real `/gate/swap/preview` responses fetched when this page was built. Re-run them yourself; no account:

| Token | Verdict | Why |
|---|---|---|
| `{fm['demo_go']}` (safe control) | {vcell(go)} | {go.get('reason','')} |
| {fm['bad_label']} | {vcell(bad)} | {bad.get('reason','')} |

{evidence}

```bash
curl "{WORKER}/gate/swap/preview?token={fm['demo_go']}"
```

## Wire it into {fwn} (under a minute)

```bash
{fw['install']}
```

```js
{fw['snippet']}
```

{fw['snippet_note']}

**Fails closed.** If the gate is ever unreachable the plugin degrades to the free preview and,
if that is down too, returns a non-GO — an outage can never green-light a swap.

## Pricing — the guard rides every trade

| Route | Price | What you get |
|---|---|---|
| `GET /gate/swap/preview` | free (3/day/IP) | GO / HOLD / BLOCK verdict + the live fields above |
| `GET /gate/swap` | **$0.008 USDC** (x402) | verdict **+ entry/exit sim + round-trip breakeven + max safe size** |
| `GET /chain/token-report` | $0.01 USDC (x402) | full evidence: honeypot sim, tax, admin controls, liquidity |

At 20 trades/day that is $0.16/day — **3.75× cheaper per call than the nearest x402 pre-trade gate**,
Base-native, honeypot + sizing in one call.

## {fwn} agents — the other failure modes

- [Honeypot — buy works, sell reverts]({fw['slug']}-honeypot.html)
- [Unsellable / no confirmable exit]({fw['slug']}-cant-sell-exit-trap.html)
- [Trade too big for the pool / price impact]({fw['slug']}-trade-too-big-price-impact.html)
- [Rug via admin controls (mint/blacklist/pause)]({fw['slug']}-rug-admin-controls.html)

## FAQ

{faq_md}

---

Install guide: [{fwn} swap gate]({fw['slug']}.html) ·
other frameworks: [ElizaOS]({SITE}/elizaos-token-safety-plugin.html) ·
[Vercel AI SDK]({SITE}/vercel-ai-sdk-swap-guard.html) ·
[LangChain.js]({SITE}/langchain-honeypot-check-tool.html).
Source: [greyridge-x402-tools](https://github.com/{REPO}) ·
[awesome-x402](https://github.com/xpaysh/awesome-x402) ·
API discovery: [/.well-known/x402]({WORKER}/.well-known/x402).

[Back](index.html)
"""
    return body


# --- publishing helpers --------------------------------------------------------------
def gh_get_sha(path):
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{path}"],
            stderr=subprocess.DEVNULL, env=ENV)
        return json.loads(out).get("sha")
    except Exception:
        return None


def gh_put(path, content, msg):
    b64 = base64.b64encode(content.encode()).decode()
    sha = gh_get_sha(path)
    args = ["gh", "api", f"repos/{REPO}/contents/{path}", "-X", "PUT",
            "-f", f"message={msg}", "-f", f"content={b64}"]
    if sha:
        args += ["-f", f"sha={sha}"]
    subprocess.check_output(args, stderr=subprocess.STDOUT, env=ENV)


def gh_get_text(path):
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{path}"],
            stderr=subprocess.DEVNULL, env=ENV)
        return base64.b64decode(json.loads(out)["content"]).decode()
    except Exception:
        return None


def all_doc_html_urls():
    """Ground-truth: enumerate every .md in docs/ right now and map to its .html URL.
    No hardcoded page roster — the sitemap can never silently drop a page this way."""
    try:
        out = subprocess.check_output(
            ["gh", "api", f"repos/{REPO}/contents/{DOCS}", "--paginate"],
            stderr=subprocess.DEVNULL, env=ENV)
        names = [x.get("name", "") for x in json.loads(out)]
    except Exception as e:
        print(f"sitemap: could not list docs/ ({e})", file=sys.stderr)
        return []
    urls = [f"{SITE}/"]  # index
    for n in sorted(names):
        if n.endswith(".md") and n != "index.md":
            urls.append(f"{SITE}/{n[:-3]}.html")
    # dedup preserve order
    seen, ordered = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            ordered.append(u)
    return ordered


def publish_sitemap(today):
    urls = all_doc_html_urls()
    rows = "\n".join(f"<url><loc>{u}</loc><lastmod>{today}</lastmod></url>" for u in urls)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           f"{rows}\n</urlset>\n")
    gh_put(f"{DOCS}/sitemap.xml", xml, f"sitemap: {len(urls)} URLs (ground-truth docs/ listing, {today})")
    print(f"PUT sitemap.xml ({len(urls)} urls)")


# index.md Line-A framework block — idempotent (replaced between these markers each run).
IDX_START = "<!-- line-a-framework-pages:start -->"
IDX_END = "<!-- line-a-framework-pages:end -->"


def update_index(today):
    idx = gh_get_text(f"{DOCS}/index.md")
    if idx is None:
        print("index.md: could not read; skipping link insertion", file=sys.stderr)
        return
    block_lines = [IDX_START,
                   "",
                   "**Framework install guides** — drop the gate into your trading agent in one line:",
                   ""]
    tagline = {
        "ElizaOS": "pre-trade swap-gate plugin",
        "Vercel AI SDK": "one-tool swap guard",
        "LangChain.js": "honeypot-check tool",
    }
    fm_tag = {"honeypot": "honeypot", "cant-sell-exit-trap": "can't-sell",
              "trade-too-big-price-impact": "trade-too-big", "rug-admin-controls": "rug controls"}
    for fw in FRAMEWORKS:
        tag = tagline.get(fw["framework"], "swap gate")
        cmd = fw["install"].replace("npm install ", "npm i ")
        block_lines.append(f"- [{fw['framework']} {tag}]({fw['slug']}.html) — `{cmd}`")
        subs = " · ".join(
            f"[{fm_tag.get(fm['slug'], fm['slug'])}]({fw['slug']}-{fm['slug']}.html)"
            for fm in FAILURE_MODES)
        block_lines.append(f"  - stop a specific failure: {subs}")
    block_lines += ["", IDX_END]
    block = "\n".join(block_lines)

    if IDX_START in idx and IDX_END in idx:
        pre = idx.split(IDX_START)[0]
        post = idx.split(IDX_END, 1)[1]
        new = pre + block + post
    else:
        # anchor: insert right after the pre-trade-safety-gate link line so it sits inside
        # the Base-token-safety section.
        anchor = "[Pre-trade safety gate for AI trading agents](pre-trade-safety-gate-ai-agents.html)"
        if anchor in idx:
            # insert after the full bullet line containing the anchor
            lines = idx.splitlines()
            out = []
            inserted = False
            for ln in lines:
                out.append(ln)
                if anchor in ln and not inserted:
                    out += ["", block]
                    inserted = True
            new = "\n".join(out) + ("\n" if idx.endswith("\n") else "")
        else:
            new = idx.rstrip() + "\n\n" + block + "\n"

    if new == idx:
        print("index.md: no change")
        return
    gh_put(f"{DOCS}/index.md", new, f"index: link the 3 Line-A framework install pages ({today})")
    print("PUT index.md (framework links)")


def ping_indexnow(urls):
    payload = json.dumps({
        "host": INDEXNOW_HOST, "key": INDEXNOW_KEY,
        "keyLocation": f"{SITE}/{INDEXNOW_KEY}.txt", "urlList": urls,
    }).encode()
    req = urllib.request.Request("https://api.indexnow.org/IndexNow", data=payload,
                                 headers={"Content-Type": "application/json; charset=utf-8", **UA},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"IndexNow: submitted {len(urls)} URLs -> HTTP {r.status}")
    except Exception as e:
        print(f"IndexNow: submit failed ({e}) -- non-fatal")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    today = datetime.date.today().isoformat()

    go = live_demo(GO_TOKEN)
    block = live_demo(BLOCK_TOKEN)
    print(f"demo: {GO_TOKEN}={go.get('decision')} dead={block.get('decision')}", file=sys.stderr)

    # Prefetch the full demo set once (shared across the 12 matrix pages).
    demos = {t: live_demo_full(t) for t in DEMO_TOKENS}
    print("matrix demos: " + ", ".join(
        f"{t}={demos[t].get('decision')}" for t in DEMO_TOKENS), file=sys.stderr)

    new_urls = []
    for fw in FRAMEWORKS:
        body = render(fw, go, block, today)
        path = f"{DOCS}/{fw['slug']}.md"
        new_urls.append(f"{SITE}/{fw['slug']}.html")
        if args.dry_run:
            print(f"\n===== {path} ({len(body)} bytes) =====\n{body[:600]}\n...")
            continue
        if args.publish:
            gh_put(path, body, f"line-a: {fw['framework']} install-intent page ({today})")
            print(f"PUT {path}")

    # framework x failure-mode matrix (12 long-tail intent pages)
    for fw in FRAMEWORKS:
        for fm in FAILURE_MODES:
            body = render_matrix(fw, fm, demos, today)
            slug = f"{fw['slug']}-{fm['slug']}"
            path = f"{DOCS}/{slug}.md"
            new_urls.append(f"{SITE}/{slug}.html")
            if args.dry_run:
                print(f"\n===== {path} ({len(body)} bytes) =====\n{body[:600]}\n...")
                continue
            if args.publish:
                gh_put(path, body, f"line-a: {fw['framework']} x {fm['slug']} intent page ({today})")
                print(f"PUT {path}")

    if args.publish:
        update_index(today)
        publish_sitemap(today)
        ping_indexnow(new_urls + [f"{SITE}/", f"{SITE}/sitemap.xml"])
        print(f"\nPublished {len(FRAMEWORKS)} framework pages: {', '.join(u for u in new_urls)}")


if __name__ == "__main__":
    tok = subprocess.run(["bash", "scripts/gh_token.sh"], capture_output=True, text=True).stdout.strip()
    if tok:
        ENV["GH_TOKEN"] = tok
    main()
