# We ran Cloudflare's Agent Readiness scanner on our x402 API. Level 5, "Agent-Native." Here's the exact checklist.

If you sell an API to AI agents, there's a new gatekeeper you may not have met yet: **Cloudflare's Agent Readiness scanner** at `isitagentready.com`. It fetches your origin the way an autonomous agent would — robots, Link headers, well-knowns, payment challenges — and grades you on a ladder from *Bot-Unaware* up to *Agent-Native*. Agents (and the frameworks wiring them up) are starting to use that grade, and specifically its **commerce** verdict, as a selection filter: *can I discover this endpoint, and can I pay it, without a human in the loop?*

We pointed it at our own x402 endpoint. The result, which you can reproduce in one curl:

```
curl -sS -X POST https://isitagentready.com/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://api.greyridgesignals.ai"}'
```

```json
{ "level": 5, "levelName": "Agent-Native",
  "checks": { "commerce": { "x402": { "status": "pass",
    "message": "x402 payment protocol detected on /api" } } } }
```

**Level 5, "Agent-Native." `commerce.x402: pass`. 12 of 23 checks green.** Below is exactly what earned it — every surface is live and inspectable right now — and, just as honestly, the checks we *don't* pass and why.

## Why this matters more than an SEO score

A human finds your API through a search result and a docs page. An agent can't. It has to find you through machine surfaces: a `Link` header that enumerates your service documents, a `/.well-known/` manifest it can parse, and a payment challenge it can answer with a wallet instead of a credit-card form. If those are missing, you are invisible to the buyer — not ranked low, *invisible*. The scanner is a proxy for "will an agent's toolchain even see me."

We're not the first to point this tool at x402 endpoints — [x402station published a sweep grading every x402 endpoint with the same Cloudflare scanner](https://www.x402station.io/blog/cloudflare-x402-readiness). The difference here isn't that we got scored; it's that we're publishing the **reference implementation** a seller can copy surface-for-surface. Credit where due: the scanner is Cloudflare's, and it's a genuinely useful forcing function for the whole ecosystem.

## The 11 surfaces that earned Level 5

**1. A root `Link` header that enumerates everything.** The single highest-leverage change. One header on `GET /` points an agent at every machine document you have:

```
link: </.well-known/x402>; rel="service"; type="application/json",
      </openapi.json>; rel="service-desc",
      </.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json",
      </.well-known/agent-card.json>; rel="agent-card",
      </.well-known/mcp/server-card.json>; rel="mcp-server",
      </.well-known/agent-skills/index.json>; rel="agent-skills",
      </.well-known/oauth-protected-resource>; rel="oauth-protected-resource",
      </.well-known/erc-8004.json>; rel="agent-registration",
      </llms.txt>; rel="describedby",
      </.well-known/security.txt>; rel="security-txt"
```

The scanner reports: *"Found agent-useful Link relations: service-desc, api-catalog, describedby…"* — **pass**.

**2–7. The well-knowns, all returning 200:**

| Path | Check | Status |
|---|---|---|
| `/.well-known/x402` | — the payable-route manifest | pass |
| `/.well-known/api-catalog` | RFC 9727 linkset, *"API Catalog found with 1 API listed"* | pass |
| `/.well-known/mcp/server-card.json` | *"MCP Server Card found"* | pass |
| `/.well-known/agent-skills/index.json` | *"Agent Skills index exists with valid JSON"* | pass |
| `/.well-known/oauth-protected-resource` | *"OAuth Protected Resource Metadata found"* | pass |
| `/.well-known/security.txt` | — RFC 9116 | pass |

**8. An A2A agent card with declared transports.** `/.well-known/agent-card.json` resolves to `"Grey Ridge Signals — x402 Data & Security API"` and declares `supportedInterfaces` of `HTTP+JSON` and `JSONRPC`. The scanner's A2A check is strict about the interfaces block — *"A2A Agent Card found"* — **pass**.

**9. Markdown content negotiation.** Agents prefer Markdown to HTML soup. `GET /` with `Accept: text/markdown` returns `200 text/markdown; charset=utf-8`, not your homepage HTML — *"Site supports Markdown for Agents"* — **pass**.

**10. `robots.txt` with Content Signals.** Not just "allow" — the newer `Content-Signal` syntax that states your AI-use policy explicitly: `Content-Signal: search=yes, ai-input=yes, ai-train=no`. The scanner reports Content Signals found, and a valid sitemap alongside — **pass** on robots, sitemap, and content-signals.

**11. The one the x402 commerce verdict actually turns on: a wire-level payment challenge.** This is the surface most x402 sellers get subtly wrong. The scanner doesn't read your `Link` header for the commerce check — it hits `/api` and looks for a *real HTTP 402 with the challenge in the headers*:

```
HTTP/2 402
www-authenticate: x402
payment-required: eyJ4NDAyVmVyc2lvbiI6Miw...   (base64 x402 challenge)
```

Decode that `payment-required` header and you get the full machine-readable offer:

```json
{ "x402Version": 2, "error": "Payment required",
  "accepts": [{ "scheme": "exact", "network": "eip155:8453",
    "amount": "1000", "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10",
    "extra": { "name": "USD Coin", "decimals": 6 } }] }
```

If your paid routes return a 402 with the challenge only in the JSON *body* — which is how plenty of working x402 servers behave — this check can read as NEUTRAL instead of PASS, and an agent using `commerce.x402` as a filter skips you. The fix is to emit the challenge as a base64 header **and** `www-authenticate: x402` on your discovery path. (A small footgun we hit: `btoa()` throws on an em-dash in a UTF-8 JSON string — encode bytes first: `btoa(String.fromCharCode(...new TextEncoder().encode(json)))`.)

## The checks we DON'T pass — and why that's honest, not a gap to paper over

Being Level 5 is not 23/23, and chasing a perfect score would mean faking signals. We don't:

- **`oauthDiscovery` / `authMd`: fail — on purpose.** We authenticate with x402 (pay-per-call USDC on Base), not OAuth. We expose the OAuth *protected-resource* pointer that the scanner rewards, but we will not publish a fake `authorization_servers` list to flip a check for an auth method we don't use. A green check that lies to an agent is worse than an honest neutral.
- **`dnsAid`, `webMcp`, `ard`, `personalAgentProtocol`: fail.** These are emerging drafts (DNS-for-AI-Discovery, WebMCP, ARD, Personal Agent Protocol) with little real agent adoption yet. We'll add them when they carry live traffic, not to game a number.
- **`mpp` / `ucp` / `acp` / `ap2`: neutral.** Those are competing commerce-discovery profiles; the scanner itself labels them "not a commerce site" for an x402 endpoint. x402 is our rail.

That's the whole point of the ladder: **Agent-Native means the surfaces agents actually read are correct and honest**, not that you've lit up every speculative draft.

## Scope, stated plainly

Agent-readiness is about **discoverability and payability** — can an agent find you and pay you without a human. It is *not* a security rating, a pentest, or a guarantee that any given agent will choose you. A `commerce.x402: pass` means the payment handshake is machine-answerable; it says nothing about whether your data is worth paying for. Those are different questions, and we won't blur them.

## Copy the checklist

Run the scanner on your own endpoint first (it's free, it's Cloudflare's):

```
curl -sS -X POST https://isitagentready.com/api/scan \
  -H 'Content-Type: application/json' -d '{"url":"https://YOUR-API"}'
```

Then, if you want to see a Level-5 reference up close, every surface above is live on ours:

- The payable-route manifest, with a free preview for every route: `https://api.greyridgesignals.ai/.well-known/x402`
- What agents see: `https://api.greyridgesignals.ai/for-agents`
- Pricing (human fiat plans + per-call x402): `https://api.greyridgesignals.ai/pricing`

Being invisible to agents is a fixable, one-afternoon problem. The scanner tells you where you stand; this checklist tells you exactly what to change.

*— Grey Ridge Signals*
