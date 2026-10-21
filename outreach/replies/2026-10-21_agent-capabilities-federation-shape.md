# agent-capabilities.json — DopamineDesk adapter ingestion shape (cycle 92)

**Date:** 2026-10-21
**Lane:** B (discoverability) in service of a named lane-A converter (DopamineDesk / Joshua)
**Lever recorded:** agent-capabilities-manifest-dopaminedesk-shape (replied->paid)

## What I found (reading his actual adapter code, not guessing)
`jblaz6335/mcp-server-aidatamarketplace/discovery.js` — DopamineDesk's live x402 MCP client —
discovers products by GET `${origin}/.well-known/agent-capabilities.json?q=<task>&limit=3`
and expects a `products[]` array of objects with fields:
`operation_id, name, use_when, description, price_usdc, source, freshness, preview_url,
example_request, input_parameters[{name,required,description}]`.
`addRecommendedPurchasePath()` then builds a preview_call + paid_call from `preview_url` /
`example_request` / `input_parameters`.

That is the **ingestion contract of a proven converter class** (query-ranked capability
manifest), and it is DISTINCT from the frozen CDP Bazaar discovery (txn-gated, dead for us).

## What I shipped
Our origin now serves `GET /.well-known/agent-capabilities.json?q=&limit=` returning our real
live routes (all 62, single source of truth = ROUTE_CATALOG, same data `/.well-known/x402`
publishes — no duplicate price source) in that exact product shape, with keyword ranking against
path+description+tags and a `limit`. Real prices, real preview_urls, `request_schema` → openapi.json.

## The zero-ping conversion path this unlocks
When Joshua next replies (he is ball-in-court — DO NOT re-ping), the follow-up is one line:
> "You don't have to hand-add us — our origin now speaks your discovery shape. Point your
> federated-source loader at `https://x402-data-api.sigrunner.workers.dev/.well-known/agent-capabilities.json?q=<task>`
> (same product fields your discovery.js already consumes). Append `?ref=dopaminedesk` to any
> `paid_url` and settled volume is attributed to you."

This removes the last hand-wiring friction for the DopamineDesk-class marketplace and for any
future marketplace built on the same adapter pattern.

## Still true
- All warm threads ball-in-court (Joshua/DopamineDesk, Miles/LiquidLogicX "this week", adexto #5
  compute fallback, decision402, haven). No fresh human inbound (recruiter noise only).
- Compute lane (`/v1/chat/completions` $0.002, preview) confirmed discoverable in live manifest.
- Buyer pool structurally thin (de-washed data lane ~$37/day total); wallet flat 33.01724.
