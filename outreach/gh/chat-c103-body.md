Saw this repo calls an x402 LLM endpoint (BlockRun `/api/v1/chat/completions`). In case a second/fallback OpenAI-compatible x402 backend is useful: `POST https://api.greyridgesignals.ai/v1/chat/completions` — same request/response shape (`messages` in, `choices[0].message` out), Llama 3.2 3B, **$0.002/call USDC on Base via x402**, no key/account. Cheap model, so best for routing/classification/short-answer steps, not heavy reasoning.

Free shape check (no wallet, no model call): `curl -X POST https://x402-data-api.sigrunner.workers.dev/v1/chat/completions/preview -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'`

Manifest: https://api.greyridgesignals.ai/.well-known/x402. Close if not relevant.
