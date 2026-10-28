# We scanned 144 live MCP servers for tool poisoning. Zero were flagged. The real exposure is something else.

Every week brings another warning about prompt injection and tool poisoning in the
Model Context Protocol. The fear is reasonable: an MCP tool whose description smuggles
hidden instructions can hijack the model that calls it. So we did the obvious thing —
we pointed our static injection scanner at a live population of MCP servers and counted.

The result surprised us, and it reframes where an MCP author should actually spend their time.

## What we measured

We ran the Grey Ridge MCP scanner against **144 live, publicly reachable MCP servers**
(1,470 tools between them, an average of 10.2 tools per server). The scan is static
detection for the two OWASP LLM-top-10 categories that live in an MCP tool surface:
**LLM01 prompt injection** and **LLM08 excessive agency** — hidden instructions in tool
descriptions, unicode/variation-selector smuggling, "ignore previous instructions"
patterns, over-broad state-changing capability, and the like. It is static analysis of
the advertised tool surface, not a penetration test and not a runtime guarantee.

Here is the live board, ranked, auto-updating as servers are re-scanned:

![Live MCP security leaderboard](https://api.greyridgesignals.ai/scan/leaderboard.svg?n=12)

## Finding 1: blatant tool poisoning is rare in the wild

Across all 144 servers, **every single one came back `clear`** on static injection —
143 graded A, 1 graded B, **0 flagged** for a poisoned tool description. You can
reproduce one for free right now:

```
curl "https://api.greyridgesignals.ai/scan/mcp/preview?url=https://mcp.deepwiki.com/mcp"
# -> {"verdict":"clear","risk_score":0,"grade":"A", ...}
```

That does not mean MCP is safe, and it does not mean injection is impossible — a
scanner finds the patterns it knows, and a determined attacker iterates. What it means
is narrower and more useful: the "every MCP tool is secretly poisoned" framing does not
match a real snapshot of what is actually deployed. The crude, static-detectable attacks
the headlines describe were not sitting in this population waiting to be found.

## Finding 2: the real exposure is rot, not poison

The same 144 servers tell a very different story on upkeep. **59.7% (86 of 144) carry at
least one directory-readiness or maintenance blocker.** Only **40.3% (58 of 144) are
directory-ready.** The not-ready servers average **11.5 blockers each**, and the backlog
across the corpus totals **986 open blockers.**

And these are not exotic failures. We counted the ratio of blockers to tools on every
not-ready server:

| blocker-to-tool ratio | servers | what it means |
|---|---|---|
| ~1.0 (one per tool) | 43 | every tool missing one required annotation |
| ~2.0 (two per tool) | 36 | every tool missing two |
| other | 7 | a mix |

**79 of the 86 not-ready servers (92%) have a blocker count that is a near-exact 1× or
2× multiple of their tool count.** That is the signature of a boring, mechanical gap —
missing titles and missing usage hints on *every* tool — not a clever attack. The worst
offender by volume, Chronary, has 54 tools and 108 blockers (exactly 2 per tool) and is
*still grade A on security*. Inferventis: 20 tools, 40 blockers, grade A. Agentboard: 35
tools, 35 blockers, grade A.

Size is not the problem either. BetSlip Doctor exposes 81 tools and is fully
directory-ready. Discipline is the variable, not scale.

So the honest headline for MCP authors in 2026 is not "you are about to be poisoned." It
is: **your server probably passes a static injection check and probably is not ready to
be listed in a connector directory — because it is unmaintained around the edges.**

## How this differs from the threat reports

Snyk, Lakera and the rest publish excellent threat research on what *could* go wrong with
LLM tool surfaces — the attack taxonomy. That work is upstream of ours and we rely on it.
What we add is downstream and empirical: we pointed a detector at a live population and
reported the distribution. The threat reports describe the tail risk; this is the base
rate. Both matter, and they point an author toward different work. The tail says "harden
against injection." The base rate says "first, close the 11 boring blockers that are
keeping you out of the directory."

## What to do with this

1. **Run the free static scan on your own server** — injection + excessive-agency,
   plus a directory-readiness verdict, no key required:
   [api.greyridgesignals.ai/scan/mcp-scanner](https://api.greyridgesignals.ai/scan/mcp-scanner?ref=greyridge)
2. **Fix the boring blockers.** If your ratio is ~1.0 or ~2.0, you are almost certainly
   missing per-tool titles and hints. That is a mechanical fix across your tool
   definitions, not a rewrite.
3. **Keep it fixed.** A scan is a photograph; servers drift as tools are added and
   dependencies move. Our hosted monitor re-scans every 6 hours and ships a live,
   embeddable badge so your passing grade stays true and your users can verify it —
   [$9.99/mo](https://api.greyridgesignals.ai/pricing?ref=greyridge). Snyk's MCP checks
   are a one-off CLI run; the gap we fill is the continuous, public, re-verified badge.

The full ranked corpus — all 144 servers, per-server scorecards — is published here:
[MCP server security scorecards](https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html).

*Scope note: Grey Ridge's MCP scan is static detection for OWASP LLM01 (prompt injection)
and LLM08 (excessive agency) on the advertised tool surface, plus connector
directory-readiness. It is not a penetration test, does not execute the server, and a
`clear` verdict is not a guarantee of safety. Numbers above are counted from the live
scorecard index (144 servers, updated 2026-10-27).*
