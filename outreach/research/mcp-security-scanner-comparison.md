Five good tools scan an MCP server for prompt injection and tool poisoning. All five hand the result to you, the author. None of them hand a signal to the people who actually need it: the users wiring your server into their agent, and the directory reviewer deciding whether to list you.

That gap is the whole reason a hosted trust badge exists. Here is the honest landscape as of October 2026, and where each tool fits.

## The scanners that run on your machine

**Snyk Agent Scan (formerly mcp-scan by Invariant Labs).** Invariant built mcp-scan; Snyk acquired Invariant in June 2025 and it now ships as agent-scan. It runs from the CLI, checks for prompt injection, tool poisoning, tool shadowing and cross-server toxic flows, and pins tool definitions by hash so a silent description change (a rug pull) is caught on the next run. A Snyk account and API token are needed for the full scan. The output is a report for the maintainer.

**Cisco mcp-scanner.** YARA-based, runs offline. Good for air-gapped review. Pattern rules over tool metadata.

**MCPhound.** Emits JSON and SARIF, maps cross-server attack chains, and hashes tool definitions between scans to flag rug pulls. The SARIF drops straight into your code-scanning tab.

**MCPShield.** The supply-chain angle: typosquatting, CVE scanning, credential exposure.

These are strong tools and worth running. We run static checks too, so the honest caveat applies to all of us equally: static and YARA-style scanning catches surface patterns, and cannot on its own tell a legitimate tool instruction apart from an adversarial one. None of this is a pentest. None of it guarantees a server is safe, and we never use that word.

## The question none of them answer

Every tool above produces a private artifact: a CLI run, a SARIF file, an account dashboard. Your users never see it. Six weeks later, after you have shipped three new tools, it is stale and nobody re-ran it.

A trust badge is the other half. It is a public URL your users (and a directory reviewer) can click to see a live grade, re-computed on a schedule, not a screenshot you pasted into a README once.

| Tool | Runs | Output | Who sees it | Re-check |
|------|------|--------|-------------|----------|
| Snyk Agent Scan | CLI (account) | report | maintainer | manual |
| Cisco mcp-scanner | CLI, offline | report | maintainer | manual |
| MCPhound | CLI | JSON / SARIF | maintainer, code-scanning | manual |
| MCPShield | CLI | report | maintainer | manual |
| Grey Ridge badge | hosted | public grade + badge | your users, directory reviewer | scheduled re-scan |

## Scanned while writing this

We ran two public servers through the free endpoint as this went up.

- mcp.deepwiki.com/mcp: 3 tools scanned, 0 issues, risk score 0, grade A, verdict clear. No tool-poisoning or injection patterns detected across 3 tools.
- gitmcp.io/docs: grade A, verdict clear, risk score 0.

Both are clean on injection. But deepwiki is not Claude Directory ready: the same scan flags 6 structural items, 0 of them hard rejects, 6 quality-polish items (tool titles, read-only hints, descriptions). We label those as quality items to polish, not hard rejects, because that is what Anthropic's published review criteria treat them as. We do not tell you a medium-severity hint will get you rejected when it will not. Crying wolf is its own kind of dishonesty, and it is the failure mode of a wall-of-warnings scanner.

Grade scale, stated plainly: A is risk 0 to 9, B is 10 to 29, C is 30 to 49, D is 50 to 69, F is 70 plus or any critical finding. It is our grade, not a third-party certification.

## Where we fit

Run Snyk Agent Scan or MCPhound in CI for your own deep audit. Then put a Grey Ridge badge on the README so your users can verify, today, that the live server still grades clean, and so a directory reviewer sees the structural checklist is handled. The free scan runs in your browser with no account. Continuous monitoring and drift alerts are $9.99/mo. A full itemized, zero-egress report for a single scan is $0.05 over x402.

Scan your server free: https://api.greyridgesignals.ai/scan/mcp-scanner

See the grades and pricing: https://api.greyridgesignals.ai/pricing

Static LLM01 and LLM08 detection and directory-readiness checks against published criteria. Not a pentest, not a guarantee, and we never claim a server is safe.
