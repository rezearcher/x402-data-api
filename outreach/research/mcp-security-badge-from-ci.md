Your MCP server's README is the first thing a developer reads before they wire it into an agent. It shows the install line, maybe a logo, maybe a build-passing badge. What it almost never shows is whether the server's own tool descriptions are clean of the prompt-injection and tool-poisoning patterns that an agent will read and act on without a human ever seeing them. That blind spot is the whole point of the OWASP LLM01/LLM08 class, and it is exactly what your users cannot check for themselves.

We shipped a GitHub Action that closes it. Add one step to your workflow and every push scans your live `tools/list` for tool-poisoning and hidden-unicode injection, assigns an A to F grade, and prints a copy-paste README badge that links to your server's live security report. Point it at your endpoint, and the job fails on a `block` verdict so a poisoned tool description cannot merge quietly.

## The badge is for your users, not just your logs

Most MCP scanners already run in CI. Snyk's Agent Scan (the former Invariant Labs mcp-scan), decoy-scan, and mcpscan-cli all emit SARIF into your repository's Security tab. That is useful, and our Action emits SARIF too. But SARIF is a signal for you, the maintainer. It is invisible to the person deciding whether to trust your server.

A README badge is the opposite. It is the signal your users see, in the one place they already look, before they connect. When we searched the current field for a copy-paste README trust badge that reflects an injection scan generated in a server author's own CI, we did not find one. Directory listings like Glama hand out listing badges, but a listing badge says "this server exists," not "its tool metadata passed a static injection scan this build." Those are different claims. Ours is the second one.

That difference is also why the badge is a distribution loop rather than a line item. Every repository that pastes it renders our grade and links back to a live report. The badge markets the scan, the scan funnels to monitoring, and the maintainer gets a trust signal in return. Nobody has to click an ad.

## Proof, pulled live while writing this

The Action is public at `rezearcher/greyridge-x402-tools@v0` (floating) and pinned `@v0.3.3`. Both tags resolved HTTP 200 this cycle. Two real public MCP servers scanned clean while writing this page: `gitmcp.io/docs` returned grade **A**, verdict `clear`, 5 tools, risk 0; `mcp.deepwiki.com/mcp` returned grade **A**, verdict `clear`, 3 tools, risk 0. The shields.io badge image, the per-server report funnel, and the pricing page each returned HTTP 200.

Here is the whole integration:

```yaml
- uses: rezearcher/greyridge-x402-tools@v0
  with:
    url: https://your-host/mcp
    commit-badge: "true"   # optional: write the badge into README.md between markers
```

With `commit-badge` off (the default), the badge Markdown lands in the job step summary for you to paste. With it on, the Action inserts and updates the badge between `<!-- grsg-badge:start -->` and `<!-- grsg-badge:end -->` and commits it, degrade-open, so a push failure on a protected branch never fails your build. The grade colors itself: A is bright green, C is yellow, F is red. The default `fail-on: review` preserves the original admission-gate behavior exactly, so adding the badge changes nothing about whether your build passes.

## What the grade is, and what it is not

An A here means no tool-poisoning or injection patterns were detected across your advertised tools on static checks. It is a static LLM01/LLM08 scan of tool metadata. It is not a penetration test, not a runtime audit, and not a guarantee. "Clear" is not "safe." One independent audit of 33 servers made the honest point that pattern-based scanning catches surface-level patterns but cannot by itself separate a legitimate MCP instruction from an adversarial one. We agree, which is why the badge links to a dated report rather than a certification, and why the grade scale says plainly that it is our grade, not a third-party seal.

That is also why a one-time scan is the weaker half of the story. Tool schemas change after install. The badge is generated on every build so it tracks your current tree, and continuous monitoring with drift alerts runs $9.99 a month.

## Try it

Scan your server free in the browser, zero-egress, no signup: [run the scanner](https://api.greyridgesignals.ai/scan/mcp-scanner). Add the Action to get the badge on every push. Keep it green as your tools change: [monitoring and drift alerts, $9.99/mo](https://api.greyridgesignals.ai/pricing).
