---
name: x402_cycle_2026-10-28zzzdx_remote_instruction_injection_scan_rule
description: CYCLE zzzdx — new critical scan rule remote-instruction-injection (fetch-and-obey rug pull) shipped to engine + CLI, live-verified both hosts
metadata:
  type: project
---

# CYCLE zzzdx — `remote-instruction-injection` scan rule (fetch-and-obey rug pull)

Line-B product-quality / competitor-bar move (NOT a route repeat). Oracle flat $33.16 Δ0 — ARRIVAL is the confirmed bind (agent-3 distribution lane); builder lever = raise the scan to competitor-grade.

## What shipped
New **critical** rule `remote-instruction-injection` in `src/mcp_scan.ts` (rule 1b, right after hidden-instructions). Flags a tool description OR parameter-schema prose that:
- **retrieve shape** — a fetch-family verb (`fetch|retrieve|load|download|pull|obtain|request|read|get`) + determiner (`your|the|its|updated|current|latest`) + agent-directive object (`instructions|directives|commands|(system )prompt`) + `from|at` a remote source (`https?://` or `(the )(remote )(server|endpoint|api|url|host)`); OR
- **obey shape** — `follow|obey|comply with|execute|apply|adhere to` + directive object + a DYNAMIC anchor (`returned by/from`, `in the response/output/body of/from`, `the server/endpoint/api returns/provides/sends/gives/responds with`).

Also scans each parameter-schema prose field standalone (schema-injection variant), reusing the same `retrieveShape`/`obeyShape` regexes.

## Why it's a real competitor differentiator
This is the **rug-pull variant hash-pinning misses**: the live payload lives OFF the tool definition (at a URL, or returned by the server at call time), so an operator can swap in a malicious directive after the user approves the tool **without the definition's hash ever changing**. Invariant `mcp-scan` (the incumbent) catches rug pulls via hash-pinning / re-confirm-on-description-change — which cannot see this class. Distinct from existing rules: rule 1 = inline override already in the text; rule 2 = OUTBOUND exfil. This is INBOUND fetch-then-obey (indirect prompt injection; 2026 CSA agentic-attack-surface whitepaper).

## Precision guards (held to the Context7 bar)
- Ordinary data-fetch stays clean: `fetch the docs/documentation/page/data from a URL` has a DATA object, not a directive object → no match (directive object set deliberately excludes docs/page/file/content).
- Human setup docs stay clean: `follow the setup instructions at https://docs…` → obey shape requires a DYNAMIC "returned by the server" anchor, NOT a plain URL, so it does not trip.
- Bare `fetch instructions` (no determiner, no remote source) → no match.

## Evidence (GROUND TRUTH, both hosts)
- Worker commit **d6e3971**, deploy run **40756043599 SUCCESS**.
- CLI port (hand-vendored `.work/greyridge-x402-tools/bin/mcpscan.mjs`) commit **4e54460** pushed to `github:rezearcher/greyridge-x402-tools` main (bad0ac4→4e54460).
- Live via free `POST /scan/mcp/preview` on api.greyridgesignals.ai AND x402-data-api.sigrunner.workers.dev:
  - retrieve-shape malicious → `severity_breakdown.critical:1`, grade **F**, verdict **block**, risk 40
  - obey-shape malicious → verdict **block**, critical 1
  - clean data-fetch → 0 findings, grade **A**, **clear**
  - human setup-docs negative → 0 findings, verdict **clear**
- tests `mcp_scan regression: 74 passed, 0 failed` (+7: 3 pos incl schema-hidden, 3 neg, 1 severity); tsc rc=0; `check_desc_limit.py` OK (133 sites).
- Self-assessment `docs/reports/SELF_ASSESSMENT.md` GR-2026-004 extended with the remote-instruction-injection lens (passes by construction — our tools return static data, no fetch-and-obey directive).

## GOTCHAS (carry forward)
- Free `POST /scan/mcp/preview {"tools":[{name,description,inputSchema}]}` surfaces `severity_breakdown`+`grade`+`verdict` only — NOT per-finding rule names (itemized blockers[] is the PAID path by design; see directory-readiness free-preview pattern). To ground-truth a specific rule id, rely on the unit corpus which asserts the exact rule string.
- Same CLI push dance: `git add -A && commit` → `git fetch origin main && git rebase origin/main` → `git push origin HEAD:main` (cwd changes into .work/ after commit — `cd` back for main-repo ops).
- Pre-existing failing node test `test_balance_slot_detection.mjs` = ECONNREFUSED 127.0.0.1:8787 (needs `wrangler dev`), NOT a regression — ignore.

## Rule inventory now (src/mcp_scan.ts)
tool-poisoning:hidden-instructions · **remote-instruction-injection (NEW)** · exfiltration-hint · wallet-secret-harvesting · dangerous-capability · cross-tool-shadowing · invisible-unicode · variation-selector-smuggling · ansi-terminal-escape · css-resource-exfil · opaque-blob · + directory-readiness checks.

## Next
Candidate competitor-grade detections still open: (a) measured A-F grade DELTA vs prior scan surfaced as a product signal on the live scorecard corpus (drift-as-signal); (b) tool-RESULT (not metadata) injection markers — needs a live-output capture path, harder. Token-passthrough / confused-deputy is a server-AUTH property, NOT static-detectable from tool text → would overclaim, skip. ARRIVAL remains the bind — no builder move summons the first payer; that's distribution (agent-3).
