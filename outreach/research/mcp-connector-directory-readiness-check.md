A clean security scan tells you an MCP connector has no obvious prompt-injection patterns. It does not tell you the connector will pass review for Anthropic's Claude Directory. Those are two different tests, and connector authors keep finding that out the expensive way: after submitting.

We scan live MCP servers for the injection class (OWASP LLM01/LLM08). This week we added a second, separate check that runs your live `tools/list` against Anthropic's published connector pre-submission checklist, so you can see whether you would pass the structural rules before you open the submission portal.

## Injection-clear is not directory-ready

Here are two public MCP servers we scanned writing this, both of which pass our injection scan with the top grade:

- **mcp.deepwiki.com**: injection verdict `clear`, grade **A**, risk score 0. Claude Directory readiness: **not ready, 6 structural blockers**.
- **gitmcp.io/docs**: injection verdict `clear`, grade **A**, risk score 0. Claude Directory readiness: **not ready, 10 structural blockers**.

Both are clean on the security axis and would still get bounced on the directory checklist. The two checks measure different things. Treating a green security scan as proof you will pass review is how authors end up in a fix-and-resubmit loop.

## What the readiness check actually tests

Every rule below is lifted from Anthropic's own published [connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria). We check your live tool definitions against the structural ones:

1. **Separate read and write tools.** A single tool that accepts both safe methods (GET/HEAD/OPTIONS) and unsafe ones (POST/PUT/PATCH/DELETE) is rejected. We flag a catch-all tool with a `method` enum that mixes the two.
2. **Reference API docs in custom query tools.** If a tool takes caller-constructed paths, query strings, or request bodies, its description must name the target API or link its docs. "Queries the Slack Web API, see api.slack.com/methods" passes; "Makes a request to the API" fails. We fire only on request-shaped params with no named API and no URL.
3. **Tool annotations.** Every tool needs a `title` plus the applicable hint, `readOnlyHint` or `destructiveHint`. Those drive auto-permissions in Claude. We flag a missing title or a missing hint.
4. **Tool names 64 characters or fewer.** Deterministic length check.
5. **Narrow, accurate descriptions.** A tool must state what it does. We fire only on a truly empty description, never on the wording of a present one.
6. **Unsupported capabilities.** Connectors that transfer money or crypto, or generate image/video/audio through an AI model, are not accepted. Diagram, chart, and mockup generation is allowed, so our match requires a transfer verb paired with a money noun, or an AI-media generate verb, to avoid false flags.
7. **Prompt-injection patterns.** The same injection findings from our security scan (tool poisoning, exfiltration hints, cross-tool shadowing, hidden unicode) are also a documented directory reject, so we fold them into the blocker list.

Each blocker in the paid report names the exact tool, the rule, and the fix.

## What this does NOT check: read this before you trust it

This is a static check against the published structural rules only. It is not Anthropic's private scan, and it cannot guarantee acceptance. It does not check your privacy policy, OAuth 2.0 configuration, DNS and domain ownership, functional quality (whether each tool returns a valid response when called), or first-party API ownership. Verify those yourself. A "ready" result means no structural blockers on the rules we can test from your tool definitions, nothing more. This is static detection, not a penetration test and not a guarantee.

## Why this exists

The connector guides that are out there, including the third-party write-ups and directory listings on sites like Glama, explain these criteria as a manual checklist you read and self-assess against. We did not find anyone running an automated scan of your live `tools/list` against the published rules. That is the gap. A reviewer applies the rules in a batch; a round trip through a rejection costs you days and a resubmission. Checking the deterministic rules in a few seconds, in your browser, before you submit, is cheap by comparison.

## Try it

Scan any MCP server free, in your browser, zero egress, no signup: [run the scanner](https://api.greyridgesignals.ai/scan/mcp-scanner). The free result gives you the readiness verdict and the blocker count. The itemized blocker list, the per-rule remediation, and continuous per-release re-checks (so a new tool in your next release does not silently break your readiness) are on the subscription: [$9.99/mo, 100 scans across every endpoint](https://api.greyridgesignals.ai/pricing), card only, no wallet. Agents can pay per scan over x402 instead.

Grey Ridge Signals builds static MCP security and Claude Directory readiness tooling. We check published rules, we tell you exactly what we do and do not cover, and we never claim a server is "safe."
