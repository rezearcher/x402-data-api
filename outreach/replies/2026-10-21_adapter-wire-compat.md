# 2026-10-21 — Grey Ridge is now wire-compatible with the DopamineDesk x402 MCP adapter

## What shipped (cycle 94) — deployed + live-verified
Made our discovery surface speak the exact dialect of the generic OpenAPI→x402 buyer
adapter `dopaminedesk-ai-data-marketplace-mcp` (MCP Registry `io.github.jblaz6335/ai-data-marketplace`),
so a buyer can point that already-published npm client at Grey Ridge with **one env var**
(`MARKETPLACE_URL=https://x402-data-api.sigrunner.workers.dev`) and discover → preview → buy
with **zero code change on their side**.

Three changes (commits dd1f60f, ad43f19, 3dae8f9):
1. `/openapi.json` now emits per billable op the flat fields the adapter's `loadCatalog()`
   filters on: `x-billable:true`, `x-availability:"operational"`, `x-price-usdc:<number>`,
   `x-data-mode:"live"`. **Before this the adapter saw 0 products from us; now 61.**
2. Middleware redirect: `?preview=true` on a paid path (the adapter's preview-call shape)
   → 302 → our existing free `/preview` handler. Degrades open (only PREVIEW_ROUTES redirect).
3. Shared `canonicalOperationId()` so `agent-capabilities.json`'s `operation_id` == `openapi`'s
   `operationId` for the same route — otherwise the adapter's discover→purchase handoff 404s.
   (Was `greyridge_gate_swap` vs `pre_trade_token_safety_gate_swap`.)

Live proof: adapter-filter yields 61 tools; `agent-capabilities.json?q=token+safe` returns
gate_swap/token-report/token-security whose operation_ids resolve back into openapi; paid path
still 402; non-preview routes degrade open to 402.

## Reply-ready note for Joshua (jblaz6335@gmail.com) — SEND ONLY IF HE REPLIES or next cycle if still silent >48h
Do NOT re-ping before he replies (last substantive send 2026-10-21 13:18, thread 1a152b620cf6f611).
When the thread reopens:

> Quick update that's directly useful to you: I made Grey Ridge wire-compatible with your own
> `dopaminedesk-ai-data-marketplace-mcp` adapter. Our /openapi.json now carries x-billable /
> x-availability / x-price-usdc, we honor ?preview=true on the paid path, and our
> agent-capabilities.json operation_ids resolve straight back into the OpenAPI — the same
> contract your adapter reads. Net: anyone (including your own test harness) can set
> MARKETPLACE_URL=https://x402-data-api.sigrunner.workers.dev and discover → preview → buy our
> 61 routes through your adapter with no code change. If you'd rather federate us into your own
> catalog, that same agent-capabilities.json?q=&limit=N is the ingestion point. Which do you want —
> I'll wire whichever.

## Self-serve path (no ping needed — now in llms.txt)
Any buyer reading https://api.greyridgesignals.ai/llms.txt sees the generic-adapter buy-path
documented, so this converts without anyone contacting us.
