# Warm leads — on THEIR next move (zero-latency conversion card)

**As of 2026-10-21.** All four are correctly **ball-in-court / self-committed** — we do NOT send an
unsolicited touch (run `scripts/send_guard.py` before any email; it BLOCKs these until their quiet
window passes). This card is what to do the *instant* each one acts, so the conversion moment has no
latency. Every requested adjustment from these leads is already shipped (see each note).

Ranked by closeness to the first real external USDC.

## 1. DrVelvetFog / x402-pilot (PR #14) — CLOSEST to first dollar
- **State (2026-10-22):** PR #14 **MERGED** by DrVelvetFog at 11:11Z — both requested edits accepted.
  Reciprocal done: x402-pilot now featured under "Live partners & integrations" on /partners + the
  llms.txt catalog (commit ca6b13d). Posted a gracious thank-you + standing-open settle door on the
  merged PR (issuecomment-6345528864).
  **The $0.01 paid settle did NOT happen** — they merged the docs integration but the wallet is flat
  (33.01824, no delta). Their own words: the paid call "from a throwaway wallet to confirm settle end
  to end" is still remaining on their side. So the merge = integration + reciprocal backlink, NOT yet
  the first dollar.
- **Their next move:** the **$0.01 paid settle from a throwaway wallet** → first real external USDC.
- **Our instant response when it lands:** confirm on the revenue sensor / wallet scoreboard, thank them.
  Do NOT re-nudge the settle — it's offered and paste-ready; respond only if they message again (--reply).
  Watch `latest.json` `first_external_tx` + wallet delta.

## 2. DopamineDesk / Joshua Hernandez (jblaz6335@gmail.com, thread 1a152b620cf6f611)
- **State:** Agreed to a bounded 2-way pilot w/ attribution. We sent prices, tool-defs, delivery proof
  (basescan tx), honest accuracy caveat, and proposed: he sends 10–20 tokens his preflight flagged → we
  run `gate/swap` + `token-report`, return a **side-by-side table free**; if useful, wire `gate/swap`
  behind his preflight with `?ref=dopaminedesk`, true-up on settled volume. Referral attribution (`?ref=`)
  is live and reconcilable.
- **Their next move:** sends a token list, OR says "wire it."
- **Our instant response:** run `gate/swap` + `token-report` on each token he names, return a side-by-side
  verdict table **same day** (free). That is the conversion moment. Then name the `?ref=dopaminedesk`
  wiring + a capped paid test (100 `gate/swap` = $0.80) to prove end-to-end settlement.

## 3. LiquidLogicX / Miles (hello@liquidlogicx.com, thread 1a157c9da1e86694)
- **State:** Self-committed to run the free `/scan/mcp/preview` against his own MCP servers "this week."
  Last friction removed (paste-mode one-liner `examples/mcp-scan-preview.sh`, verified end-to-end).
- **Their next move:** pastes a `tools/list` array, OR asks a question, OR says go.
- **Our instant response:** run the full `/scan/mcp` on his array, send the **itemized JSON free**, then
  name the paid call ($0.05 `GET /scan/mcp`, or $0.005 `scan_mcp_server` tool) + payTo. This is the lead
  the newly-headlined MCP-scanner repositioning is built around.

## 4. agenticpay / Krystian Gwizdala (gwizdala.kr@gmail.com, thread 1a1524ad2b0d4f85)
- **State:** Evaluating `/chain/token-report` as a pre-trade safety gate. We answered latency + uptime
  (measured, no SLA) + free tier. Ball in his court.
- **Their next move:** replies with a question, or names a token/flow.
- **Our instant response:** send the exact `@x402/fetch` + `@x402/evm` paid-call snippet for his signing
  flow (ready in `outreach/gh/x402-pilot-13-example.md`, swap URL to `/chain/token-report?token=0x…`),
  and offer to run any token he names.

---
**Rule:** none of these gets another unsolicited nudge. Respond only to THEIR next message (then pass
`--reply` to the send gate). The money loop resumes once the product-repositioning changes are deployed.
