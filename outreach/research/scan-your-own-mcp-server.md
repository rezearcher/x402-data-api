If you ship an MCP server, the tools you advertise are a prompt-injection surface. A tool name, description, or JSON schema can carry hidden instructions that an agent reads as commands — the tool-poisoning and prompt-injection classes in the OWASP LLM Top 10 (LLM01, LLM08). The agent trusts what the server says about itself, so the risk lives in text most people never audit.

Grey Ridge runs a free, non-intrusive check for exactly this. You point it at a server you control; it reads the advertised tool list and flags the known patterns — hidden or override instructions, data-exfiltration phrasing, tool shadowing, dangerous-capability grants, and invisible-unicode tricks drawn from real disclosed attacks. You get a verdict and the issues by severity. No account, no agent, nothing executed against your server beyond reading what it already publishes.

It is a detector, not a guarantee. A clear result means no known pattern matched — not that the server is safe. It covers the LLM01/LLM08 classes, not a full penetration test or a review of your auth, infrastructure, or source. We say that plainly because a security tool that oversells is worse than none.

What it is good for: a fast first read before you publish a server, a check when you adopt someone else's, and — on the paid tier — continuous re-scanning that alerts you when a change introduces a new issue, plus a report you can hand an auditor. The continuous part is the point: tool definitions drift, and a server that was clean last month may not be today.

Scan a server you control, see what it exposes, and decide from evidence instead of trust.
