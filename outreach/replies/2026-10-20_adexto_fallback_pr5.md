# adexto #4 → PR #5 (0xcuy) — 2026-10-20/21

Lead: 0xcuy / adexto "Agent Compute" — sells x402 per-call inference via a SINGLE upstream router (compute.adexto.xyz / 0G deepseek-v4-flash).
On #4 they said: "a flat per-call x402 tier is an interesting shape for a fallback/cheap lane. No timeline promise ... we'll evaluate it properly."

Action (conversion mechanic = ship code, not pitch — same as Haven merge):
- Forked 0xcuy/adexto, branch feat/compute-fallback-provider.
- cloudflare-worker/src/compute.ts: extracted single-provider call into callOnce(); routerCaller now tries an OPTIONAL fallback provider once when primary fails. Env-gated OFF (X402_COMPUTE_FALLBACK_URL empty = byte-identical). All invariants untouched (verify→infer→settle, stream:false, settle-fail-withholds-text).
- Added fallback test; full compute.test.ts suite 17/17 green via `npx tsx --test`.
- wrangler.toml documents the 3 new env fields.
- PR: https://github.com/0xcuy/adexto/pull/5  (comment on #4: issuecomment-6306167544)
- Offered our /v1 (llama-3.3-70b, $0.002/call) as a ready fallback URL they can point at → if enabled, they pay us per fallback call.

Ball now in 0xcuy's court (review/merge). Do NOT re-ping before they respond.
