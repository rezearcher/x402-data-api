When someone connects an agent to your MCP server, they are trusting text they never read. The tool names, descriptions, and JSON schemas your server advertises are fed straight into an LLM as instructions. That is the whole attack surface behind the tool-poisoning and prompt-injection classes in the OWASP LLM Top 10 (LLM01, LLM08): a hidden instruction inside a tool description is a command the agent will follow.

This is not theoretical anymore. A March 2026 research note from the Cloud Security Alliance counted more than thirty CVEs disclosed against MCP infrastructure between January and early March 2026, and reported that tool poisoning is now the most frequently observed active exploitation technique against agentic deployments. The servers getting hit are not exotic. They are ordinary servers whose tool metadata changed and whose users had no way to notice.

A one-time scan does not fix that, because the risk is a moving target. You can audit a server today, ship a new tool tomorrow, and the audit is now a photo of a server that no longer exists. Your users cannot tell the difference. That gap between "was checked once" and "is checked continuously" is the whole problem.

## A badge your users verify, not a report you file

Grey Ridge runs a [free, read-only scan](https://api.greyridgesignals.ai/scan/mcp-scanner) of any MCP server you control. Point it at your server, it reads the advertised tool list, and it flags the known patterns drawn from real disclosed attacks: hidden or override instructions, data-exfiltration phrasing, tool shadowing, dangerous-capability grants, and invisible-unicode tricks. You get a verdict, a letter grade, and the issues by severity. Nothing is executed against your server beyond reading what it already publishes.

What makes this a distribution tool and not just a scanner is the badge. The monitored badge is a live shields.io endpoint, generated from [the badge generator](https://api.greyridgesignals.ai/scan/badge-gen), that you embed in your README or server listing. It is not a static image that says "passed." It re-scans your server every six hours and reflects the current state. A clean server reads green. If the subscription lapses or a failed charge interrupts monitoring, the badge flips to grey on its own. If we cannot confirm you still own the host, it will not show green. The default state of an unclaimed host is a plain grey "unclaimed," never a false green.

That honesty is the point. A badge that can only ever say "good" is marketing. A badge that can go grey is a signal your users can actually trust, because it costs you something to keep it green.

## Where this sits next to the other tools

Snyk's mcp-scan (the former Invariant Labs CLI) is a strong operator-side tool: you run it on your machine with a Snyk account token, and it analyzes tool descriptions against their cloud. It is built for the developer auditing their own project. It is not a public, user-facing badge, and Invariant's hosted live-proxy mode was wound down in early 2026. Sigil publishes Ed25519-signed, version-pinned badges to a public git index, which is a clean approach to signed provenance; it pins a badge to a scanned version. CraftedTrust indexes thousands of packages with a seven-factor score and free embeddable badges across a directory.

Our wedge is narrow and specific: a per-server, ownership-verified badge that re-checks the live server every six hours and degrades to grey the moment monitoring stops. It is built so the person reading your README, not just you, gets a current answer.

## What it is and is not

This is static analysis of MCP tool metadata for the LLM01 and LLM08 classes, plus continuous re-scanning. A "clear" result means no known pattern matched. It is not a penetration test, not a review of your authentication, infrastructure, or source code, and not a guarantee that your server is safe. We say that plainly, because a security tool that oversells is worse than none. The grade (A through F, from our own risk score) is our read, not a third-party certification.

Here is what we scanned while writing this, live: gitmcp.io/docs, grade A, five tools, clean on static checks. mcp.deepwiki.com, grade A, three tools, clean. gitmcp.io/microsoft/typescript, grade A, four tools, clean. Those are real reads from this hour, not stored results.

The free scan and the public report page are open to anyone, no account and no wallet. Monitoring, drift alerts, the dated posture-history timeline, and the full auditor-grade report are the [paid tier at 9.99 dollars a month](https://api.greyridgesignals.ai/pricing), which also gives you an API key for 100 scans across every Grey Ridge endpoint so you can fail your CI build on a bad result. Scan a server you control, embed the badge your users can verify, and let the grey state do the honest work.
