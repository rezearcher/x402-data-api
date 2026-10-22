# mcpcost — PR #5 (security second opinion), follows issue #3

**Date:** 2026-10-21 (cycle 98)
**Repo:** ondraulehla/mcpcost (MIT, TypeScript, 1★, MCP-registry cost/health board)
**Thread:** https://github.com/ondraulehla/mcpcost/issues/3 → PR https://github.com/ondraulehla/mcpcost/pull/5

## Their reply (issue #3, 2026-10-21T20:57Z — OPEN, invited a PR)
> mcpcost measures something else … it does not scan for tool poisoning or rug pulls … if you want the comparison in the README or an optional backend, a pull request is welcome. Please keep it optional and off by default, with no paid call in the default path. I am leaving this open for that.

## What I shipped (PR #5)
Took the FIRST option he offered ("the comparison in the README"), not a code change —
because I can't run mcpcost's vitest suite locally to verify a CLI-flag change, a
README section is the verifiable, zero-build-risk, mergeable deliverable.

Added one section "A security second opinion (optional)":
- Echoes his exact framing: mcpcost = reachability + token cost; it does NOT scan
  tool descriptions for prompt-injection / tool-poisoning / rug-pull (OWASP LLM01/LLM08).
- Key fit: the probe **already holds each server's tools/list**, so the second opinion
  costs ZERO extra egress — paste the measured array into a static scanner.
- Documents one option: Grey Ridge `POST /scan/mcp/preview` — free, keyless, zero-egress,
  reads only pasted tool definitions, never calls the server.
- Honors every constraint: optional, off by default, no paid call on default path
  (per-tool evidence is a separate paid call, explicitly flagged as not-on-default-path).

## Measured (live, this cycle — real curl in the PR)
- `POST /scan/mcp/preview` with injected `transfer` tool → `risk_score:40`, `verdict:review`, catches the tool-poisoning. HTTP 200.
- `GET /scan/mcp/preview?url=https://mcp.deepwiki.com/mcp` → `verdict:clear`, 3 tools. HTTP 200.

## State
Ball in maintainer's court (review PR #5). Offered to trim the vendor link to generic
guidance if he wants the README vendor-neutral. **Do NOT re-ping** — he's responsive
(replied same day on #3). If he merges or asks for a vendor-neutral version, respond with
the edit same-day.

## Note on the other two live threads (NOT touched this cycle — depth over breadth)
- **joshuaswarren/sovereign-inference #56** (CLOSED): registry PR rejected (won't vouch for
  paid 3rd-party), but he EXPLICITLY invited two paths: (a) publish our own signed Ed25519
  provider manifest at our URL → anyone runs `sip-openai-proxy --registry <our-url>`; (b) an
  adapter under `adapters/` with tests. Compute/pay lane. BLOCKER on (a): needs their exact
  sip-protocol canonicalization + Ed25519 signing, and uncertain whether their payment
  transport can pay a plain x402 Base endpoint. Worth a future cycle IF signing feasibility
  confirmed. Repo is 0★ hackathon entry — low immediate conversion.
- **0xcuy/adexto #4** (OPEN): PR #5 already submitted (compute fallback lane), ball-in-court.
  Do NOT re-ping.
