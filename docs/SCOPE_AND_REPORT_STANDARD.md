# What we sell, what we don't, and the report bar

Two non-negotiables (Rez, 2026-10-23): (1) be CLEAR about scope — what the product does and does NOT do — at the offer AND restated in the confirming/post-purchase docs and in every report; (2) once someone pays, the deliverable meets the level of real competitors' reports. Overclaiming coverage on a security product is both a trust failure and a liability. Claims Law applies: every statement traces to a real scan result.

## WHAT WE SELL (state it exactly this way, everywhere)

**Automated STATIC detection of MCP tool-poisoning & prompt-injection exposure (OWASP LLM01/LLM08), with continuous monitoring.** We analyze a server's *advertised* MCP tools — names, descriptions, JSON schemas — against signatures from real disclosed attacks (Invariant Labs tool-poisoning, hidden-instruction/override, exfiltration, tool-shadowing, dangerous-capability, hidden-unicode). Output: per-tool findings with severity + evidence + remediation, an overall verdict (clear/review/block), and — on the paid tier — re-scanning on a schedule with drift/new-issue alerts, an auditor-ready report, and CI/API integration.

## WHAT WE DO NOT SELL (say so plainly — do not let copy imply otherwise)

- NOT a runtime/dynamic pentest — we do static analysis of advertised tool metadata, we don't execute the server or fuzz it live.
- NOT a full security assessment of the host — no auth/authz, network, infra, supply-chain, or source-code review (that's the optional human engagement upsell, scoped separately).
- NOT a guarantee or certification — a "clear" verdict means no *known* pattern matched, not "safe." We produce evidence that SUPPORTS a SOC2/ISO audit; we do not certify compliance.
- NOT coverage of attack classes outside LLM01/LLM08 unless explicitly listed.
Surfacing: a one-line "what this checks / what it doesn't" on the offer page + the free result; the full statement in the post-purchase confirming doc + the top of every report's Scope section.

## PAID REPORT STANDARD (match competitors — reuse in-house skills `reporting-bug-bounty`, `poc-creation`)

Every paid report ships these sections (the converged professional pentest-report skeleton; align to ISO 27001 / NIST / PCI where the customer needs it):
1. **Executive summary** — non-technical, ≤1 page: what was scanned, overall risk posture, finding counts by severity, the 2–3 themes that matter. No exploit detail.
2. **Scope & methodology** — exactly what was tested (which tools/endpoints), the static-signature approach, the OWASP LLM01/LLM08 basis, and the explicit limitations from "WHAT WE DO NOT SELL." (Auditors read this first.)
3. **Findings** — one entry each: title, severity, **CVSS v3.1/v4.0 vector + score AND an OWASP risk rating**, the matched evidence (the offending tool text, redacted as needed), concrete impact, and ONE specific remediation. Rank by realistic impact, not CVSS alone.
4. **Remediation roadmap** — ordered: what to fix first and why.
5. **Retest / status** — on a re-scan, each prior finding marked fixed/open/regressed (the monitoring tier's recurring value).
6. **Appendix** — raw findings JSON, signatures/rules referenced, external references (OWASP LLM Top 10, the disclosed-attack sources).
7. **Standards mapping** (when relevant) — which findings map to which control (SOC2/ISO/NIST).

Quality bar: reads as a professional security firm's output (run `humanizer`; no AI tells, no Claude/Anthropic attribution). CVSS vectors must be justified, not asserted. If the scanner can't substantiate a claim, it isn't in the report.

## FREE vs PAID (what's gated)

- FREE: executive verdict + severity counts + categories hit. "Do you have a problem?" No per-finding detail, no CVSS, no remediation text, no report file, no monitoring.
- PAID (self-serve subscription): the full report above (details, CVSS, evidence, remediation, roadmap), continuous re-scan + alerts, multiple assets, the downloadable auditor-ready report, CI/API + badge.

Sources (report-anatomy convergence, 2026): securelayer7.net, redfoxsec.com, brightdefense.com; in-house: skills `reporting-bug-bounty` (CVSS 3.1, impact narrative, severity discipline), `poc-creation` (evidence capture, CVSS handoff). Scan scope: `src/mcp_scan.ts`.
