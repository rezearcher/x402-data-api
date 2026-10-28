# Add one MCP server to your agent and it can check a Base token before it trades — and audit its own tools

Most crypto MCP servers hand an agent *data*: prices, balances, yields. Useful, but
data is not a decision. When an autonomous agent is about to swap into a token it found
five seconds ago, the question it actually needs answered is narrower and scarier: **can
I sell this again, or is it a honeypot, and is my trade too big for the pool?** That is a
safety call, and almost no MCP server makes it callable from inside the agent loop.

Grey Ridge is a single streamable-HTTP MCP endpoint that does. Drop one block into your
MCP client config and your agent gets **26 tools** — Base pre-trade safety, token
honeypot/rug checks, on-chain reads, market data, *and* an MCP security auditor it can
point at other servers — with **keyless free previews** and pay-per-call settlement in
USDC. No account, no API key, no signup form.

## The one-block install

```json
{
  "mcpServers": {
    "grey-ridge-x402": {
      "type": "streamable-http",
      "url": "https://api.greyridgesignals.ai/mcp"
    }
  }
}
```

On connect, the server identifies itself and injects its own usage instructions into the
model's context (MCP `initialize` → `serverInfo` + `instructions`), so the agent knows
what the tools are for before it calls one:

```
serverInfo: { "name": "Grey Ridge MCP Security + Base Trade-Safety", "version": "0.1.4" }
```

## What the agent can call

The 26 tools split into two capabilities on the same connection:

**Base pre-trade safety (the flagship).** `gate_swap` returns a single
**GO / HOLD / BLOCK** decision sized to your trade — honeypot/sellability plus Uniswap-v3
liquidity-vs-notional price impact, one reason string, one call. `chain_token_report`
returns a **SAFE / CAUTION / AVOID** verdict with measured on-chain transfer tax, and
`chain_token_security` runs a live `eth_call` state-override transfer simulation to catch
honeypots that only tax the pool. A free `gate_swap_preview` on five demo tokens
(`usdc|weth|cbbtc|aero|degen`) returns the full shape so you can wire it before you ever pay:

```
gate_swap_preview(token="weth") ->
{ "decision": "go", "verdict": "SAFE", "risk_score": 0,
  "liquidity_usd": 136274969, "impact_pct_of_pool": 0,
  "reason": "token passes safety checks; trade is 0.00% of pool liquidity" }
```

**MCP security scanning.** `scan_mcp_server` runs a static tool-poisoning /
prompt-injection audit (OWASP **LLM01** + **LLM08**) of any MCP server's advertised
tools — hidden instructions, unicode/variation-selector smuggling, over-broad
state-changing capability. `scan_mcp_preview` does the same for free with counts and a
risk score. No tool is ever invoked; it reads only the advertised `tools/list` surface.

Here is the live token-safety verdict the gate produces for WETH, as an auto-updating
badge you can embed anywhere:

![Grey Ridge token-safety badge for WETH](https://api.greyridgesignals.ai/chain/token/badge?token=0x4200000000000000000000000000000000000006)

## Pricing: keyless, inline, sub-cent

Previews are free. Full results settle over x402 in USDC on Base — the agent pays inline,
per call, from its own wallet, with no account and no key:

| tool | price | what you get |
|---|---|---|
| `gate_swap` | **$0.008** | GO/HOLD/BLOCK sized to your trade |
| `chain_token_security` | **$0.009** | live honeypot/sellability simulation + proxy/upgradeability flags |
| `chain_token_report` | **$0.01** | SAFE/CAUTION/AVOID + measured transfer tax |
| `scan_mcp_server` | **$0.05** | itemized MCP injection findings + verdict |

Every one of those figures is the live `402` amount today — call the paid route without
payment and the server returns an x402 v2 challenge quoting the exact price.

## Honestly, where this fits versus the free REST APIs

GoPlus Security and honeypot.is are genuinely good, and GoPlus's token-security API is
**free** — if you are building a REST integration, use them. Grey Ridge is not trying to
undercut a free API on price. The gap it fills is **delivery**:

- **It is a tool your agent already holds.** The safety check lives on the same MCP
  connection as the agent's data tools, so the model can call it mid-reasoning — "about
  to swap, let me gate it first" — instead of you bolting a separate REST client onto the
  runtime and teaching the agent to use it.
- **It returns a decision, not fields.** `GO/HOLD/BLOCK` sized to *your* notional, not a
  bag of risk booleans you still have to turn into a rule.
- **It is keyless and pay-as-you-go.** No signup, no key rotation, no plan — the agent
  settles sub-cent in USDC inline, which is the native payment model for an x402 agent.
- **Both halves on one endpoint.** The same server that gates your trades can audit the
  *other* MCP servers your agent is wired to.

## What a "GO" and a "clear" do and do not mean

Read these the way we write them. A `GO` / `SAFE` from the trade gate is a point-in-time
risk read from on-chain state and a sized liquidity check — **not** a guarantee the token
is safe or that the trade will be profitable; contracts change and liquidity moves. A
`clear` from the MCP scanner means no *static* red flags were found in the advertised
tool surface — **not** a penetration test and **not** a promise the server is safe at
runtime. Both are designed to fail safe (HOLD/BLOCK, review/block) when a signal is
missing, not to wave trades through.

## Try it in two calls, no key

```
# free preview — a sized GO/HOLD/BLOCK for a demo token
curl "https://api.greyridgesignals.ai/gate/swap/preview?token=weth"

# free MCP injection scan of any public server
curl "https://api.greyridgesignals.ai/scan/mcp/preview?url=https://mcp.deepwiki.com/mcp"
```

Add the config block above and your agent has both capabilities — all 26 tools — the next time it
connects. When you want the full paid result, it pays itself — in USDC, inline, per call.
