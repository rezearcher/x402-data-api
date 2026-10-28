A security scan of an MCP server is a photograph. It tells you the tool definitions were clean at the moment the shutter clicked. It tells you nothing about the six months after, when the server's source repo quietly goes a year without a commit, or one of its npm dependencies catches a published advisory the week after you wired it into your agent.

We scanned 144 public MCP servers. Every one of them is clean on prompt injection and tool poisoning: risk score 0 across the board, 143 graded A and 1 graded B on our scale. That result is real, and it is also the point. If 100% of the servers pass the static scan, the static scan is not where the ongoing risk lives. The risk lives in time.

## The two signals a one-time scan can't see

So we added a second grade to every scorecard, built on two live signals that have nothing to do with the tool list and everything to do with whether a server is still being cared for.

**Repository maintenance.** We resolve the server's declared source repository and read its last-push date from the public GitHub API, no token required. A repo pushed in the last 30 days grades fresh (A). 30 to 180 days is active (B). 180 to 365 is slowing (C). Past a year is stale (D). An archived or disabled repo is the loudest signal of all — abandoned, F. No public repo to measure means we assert nothing: the grade is left blank, not faked green.

**Supply-chain advisories.** We take the server's declared published packages and query the OSV database in a single keyless batch, plus check npm for a deprecated latest version. Zero advisories and not deprecated is clean (A). One or two known advisories is caution (C). Three or more is high (D). A deprecated latest version on its own is caution — it is the maintainer's own "do not use" flag. No declared package means no grade, again blank rather than invented.

Both checks degrade open. When the data isn't there, the scorecard says "not measurable" and tells you exactly why, instead of punishing a server for a signal we couldn't read.

## Two real examples, live right now

From the corpus, verbatim off the published scorecards:

- **ApexAI Academy** — *Maintenance grade A — last commit pushed 11 day(s) ago, 2 open issue(s). Supply chain: not measurable — this server declares no published package to trace upstream advisories against.*
- **DeepWiki** — *Maintenance: not measurable — no public source repository to measure maintenance from.*

That second one is the honest common case. Most MCP servers in a public registry don't declare a source repo or a published package, so the maintenance and supply-chain grades are often "not measurable" today. We show that plainly rather than guess. When a server does declare its repo — like ApexAI — you get a real, dated maintenance read you can act on.

## Where this sits next to the tools you already know

| | Grades repo maintenance | Reads upstream advisories | Continuous drift alert | Public badge your users see |
|---|---|---|---|---|
| Snyk Agent Scan (CLI) | no | yes (your deps, on run) | manual re-run | no |
| Lakera (runtime injection) | no | no | runtime, not repo | no |
| Glama quality score | no | no | daily sync | on Glama's page |
| Grey Ridge scorecard | **yes** | **yes** | **six-hourly** | **yes, embeddable** |

Honest positioning, because that is the only kind worth publishing. Snyk's agent scan is a strong dependency and tool-poisoning tool — run it in CI for your own deep audit; it reads your dependencies when you run it, not a hosted server's declared packages on a schedule. Lakera guards the runtime against injection; it is not a repo-health signal. Glama runs recurring scans and syncs daily, and its quality score is a genuinely useful measure — but it is built from Tool Definition Quality (70%) and Server Coherence (30%), not from whether the source repo has gone stale or an upstream package caught an advisory since you installed it.

That gap — maintenance recency plus upstream advisories, re-checked on a schedule and surfaced as a public grade — is the one we fill.

## Why continuous is the product

A grade is a point-in-time measurement, not a warranty. The value isn't the number today; it is the alert the week a server's upstream ships an advisory, or the month its repo crosses from active into stale. We re-check all three signals — injection scan, maintenance, supply-chain — every six hours and alert on any worsening. That continuous drift watch is the $9.99/mo monitoring subscription. The one-time scan, and the badge you embed in your README so your own users can verify the live grade themselves, are free.

Scan your server free: https://api.greyridgesignals.ai/scan/mcp-scanner

See the grades and the leaderboard: https://rezearcher.github.io/greyridge-x402-tools/mcp-server-scorecards.html

Pricing: https://api.greyridgesignals.ai/pricing

This is static LLM01 and LLM08 detection plus maintenance and supply-chain signals, re-checked on a schedule. It is not a penetration test and not a guarantee, and we never tell you a server is safe. A grade is a measurement, not a certification.
