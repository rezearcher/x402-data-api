# mcp-egress (basitalisandhu) #19 — offline reader shipped → README-link offer

**Thread:** https://github.com/basitalisandhu/mcp-egress/issues/19 (closed; offer still live)
**Their offer (2026-10-20):** "If you add a reader for that format [egress.json offline, no network], I am happy to link it from the README next to mcp-tools-lint." Declined paid/remote scanning (correct — mcp-egress's whole promise is no undeclared egress).

**Blocker found:** our `bin/mcpscan.mjs --from-egress` was POSTing the recorded tool metadata to our hosted preview = exactly the undeclared egress his tool flags → unlinkable.

**Fix shipped (commit a1093ca, greyridge-x402-tools):** ported the hosted /scan/mcp rule engine (OWASP LLM01/LLM08 + Invariant tool-poisoning sigs) into the CLI so `--from-egress egress.json` scores FULLY OFFLINE — zero network I/O, exit 2=block/1=review/0=clear. Verdict verified identical to hosted API (60/review on shared fixture; clean→0, block→2 confirmed).

**Reply posted:** https://github.com/basitalisandhu/mcp-egress/issues/19#issuecomment-6309365093 — gave the pinned one-liner (`npx github:rezearcher/greyridge-x402-tools#a1093ca mcpscan --from-egress egress.json`), adopted his "pin to a commit not @main" docs note, composed-pipeline snippet.

**Status:** ball-in-court on maintainer for the README link. Do NOT re-ping. Value = README backlink from a security-conscious MCP-tooling repo (real human dev audience) + free OSS funnel artifact → paid live-URL /scan/mcp.
