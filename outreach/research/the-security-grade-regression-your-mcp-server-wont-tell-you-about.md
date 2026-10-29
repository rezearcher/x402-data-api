# The security-grade regression your MCP server won't tell you about

A one-off scan tells you a server is clean *today*. It says nothing about the
version you'll be running next week. MCP servers update their `tools/list`,
swap in a remote instruction source, or widen an input schema — and the scan
you ran at install time is now describing a server that no longer exists.

That gap is a supply-chain problem, and it's the one point-in-time scanners
structurally can't close.

## What we added: a grade that moves

Every MCP scan Grey Ridge runs now returns an **A–F security grade** derived
from a transparent 0–100 risk score:

| Grade | Risk score | Meaning |
|-------|-----------|---------|
| A | 0–9 | No LLM01/LLM08 patterns detected |
| B | 10–29 | Minor findings |
| C | 30–49 | Multiple findings |
| D | 50–69 | Serious findings |
| F | 70+ **or any critical** | Do not admit until resolved |

Live, right now: a server whose tool declares `private_key` / `seed_phrase` /
`mnemonic` inputs grades **F / block** (one critical tool-poisoning finding,
risk 40). A plain weather tool grades **A / clear** (risk 0). Try it keyless:
`POST /scan/mcp/preview` with a `tools` array.

It is a grade, not a certification — "our grade, not a third-party audit,"
said verbatim in every response. It's static detection of the OWASP LLM01
(prompt/instruction injection) and LLM08 (excessive-agency / wallet-secret
harvesting) patterns in a server's declared tool schemas. It is not a pentest
and it does not make a server "safe."

## The part that's continuous

For a monitored host, the scan re-runs **every six hours** on a schedule. When
the grade changes between sweeps, the drift alert carries a `grade_delta`:

```json
"grade_delta": { "from": "A", "to": "C", "direction": "worsened", "letters": 2 }
```

`direction` is one of `improved` / `worsened` / `same` / `unknown`. A
**`worsened`** delta is a security-grade regression — a supply-chain change
that degraded the server's posture since the last clean sweep. That is the
event you actually want paged on: not "it was fine at install," but "it just
got worse." (A first-ever baseline, or a prior grade we can't trust, reports
`unknown` and `letters: 0` — it never fires a false regression on day one.)

## Why continuous, not one-off

Snyk and Socket ship excellent point-in-time CLIs — you run them, you get an
answer for that commit. The gap they leave open is *time*: nothing watches the
server after the scan. Our wedge is the opposite shape — a hosted grade that
keeps re-scanning and tells you the moment it drops. Same honest static
detection; the difference is a signal that fires when a server you already
trusted changes under you.

Monitoring with drift alerts is **$9.99/mo** at `/pricing`. The scan itself,
and the grade, are free: `POST /scan/mcp/preview`. Embed the badge and the
grade becomes visible to everyone who looks at your server.
