# MCP server security, start to finish: scan it, badge it, keep it graded

If you publish an MCP server, someone will eventually ask whether it is safe to connect to. This guide collects everything Grey Ridge has published on answering that question with evidence instead of adjectives. Each step has a free tool you can run right now.

Scope, stated once: our scanner does static detection of OWASP LLM01 (prompt injection) and LLM08 (excessive agency) on the tool surface your server advertises. It is not a penetration test, and a good grade is not a guarantee. It tells you what a pattern-based reader can see, and it tells your users the same thing.

## Step 1. Get a grade (free, about ten seconds)

```
curl "https://api.greyridgesignals.ai/scan/mcp/preview?url=<your-mcp-url>"
```

You get a verdict, a risk score and an A to F grade, with no signup or key. Walkthrough: [Scan your own MCP server](https://api.greyridgesignals.ai/research/scan-your-own-mcp-server).

What the scan sees in practice: in a run over 144 live public servers (1,470 tools), none were flagged for a poisoned tool description. The exposure that tends to matter is elsewhere, which is why the next pages cover drift and dependencies. Detail: [We scanned 144 live MCP servers](https://api.greyridgesignals.ai/research/mcp-prompt-injection-scan-144-servers).

## Step 2. Understand what a scan can and cannot see

- [MCP tool descriptions are attack surface](https://api.greyridgesignals.ai/research/mcp-tool-descriptions-are-attack-surface-scan-yours-before-you-ship): why the description field is where injection lives.
- [MCP SDK CVEs in 2026](https://api.greyridgesignals.ai/research/mcp-sdk-cves-2026-what-a-scan-catches): which SDK-level problems a tool-surface scan catches and which it does not.
- [The bearer-token audience CVE](https://api.greyridgesignals.ai/research/mcp-bearer-token-audience-cve-2026-111771-what-a-scan-cant-see): an auth bug that a static scan is blind to, with a five-step checklist.
- [How other MCP scanners compare](https://api.greyridgesignals.ai/research/mcp-security-scanner-comparison): where a free one-off CLI is enough and where continuous grading adds something.

## Step 3. Show your users the result

A grade only helps if people can see it and check it.

- [An MCP trust badge your users can verify](https://api.greyridgesignals.ai/research/mcp-trust-badge-your-users-can-verify)
- [Three trust badges for your MCP server](https://api.greyridgesignals.ai/research/three-trust-badges-for-your-mcp-server): security grade, directory readiness, monitored status.
- [Generate the badge from CI](https://api.greyridgesignals.ai/research/mcp-security-badge-from-ci): fail the build when the verdict is `block`.
- [Directory readiness check](https://api.greyridgesignals.ai/research/mcp-connector-directory-readiness-check): what connector directories look for before they list you.

## Step 4. Keep the grade honest over time

A scan is a snapshot. Servers change: a dependency bumps, a tool gets added, a description is edited.

- [Continuous monitoring vs a one-off scan](https://api.greyridgesignals.ai/research/continuous-mcp-security-monitoring-vs-one-off-scan)
- [The grade regression your server will not tell you about](https://api.greyridgesignals.ai/research/the-security-grade-regression-your-mcp-server-wont-tell-you-about)
- [Maintenance and supply-chain drift](https://api.greyridgesignals.ai/research/mcp-server-maintenance-and-supply-chain-drift)
- [A public grade history for your server](https://api.greyridgesignals.ai/research/a-public-grade-history-for-your-mcp-server)

Monitoring is the paid part: we re-scan on a schedule, keep the history, and the monitored badge only turns green for a verified owner with an active subscription. The scan, the grade and the basic badge stay free.

## The shortest path

1. Run the preview curl above on your server.
2. If it is not an A, read the finding class and fix the description or capability it points at.
3. Add the badge to your README.
4. Turn on monitoring if you want the grade to stay true after your next release.

Questions about what a grade means or does not mean: the scope paragraph at the top is the whole answer. We detect patterns in what a server advertises. We do not certify safety.
