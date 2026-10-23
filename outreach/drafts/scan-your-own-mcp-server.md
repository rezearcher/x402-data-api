Half of the public MCP registry will hand its full tool list to anyone who asks. We measured it: across 364 remote servers we probed on registry.modelcontextprotocol.io, 174 answered a tools/list request with no credentials at all. That list of names, descriptions and JSON schemas is exactly what a language model reads before it decides to call anything, so it is also the surface a prompt-injection or tool-poisoning attack lives on.

The part most coverage gets wrong is the next number. Confirmed poisoning across those 174 readable servers, scanning 1,515 advertised tools, was zero. The public ecosystem is wide open to inspection and is not, today, full of overt poisoning. Both facts are true at once, and they tell you something useful about where to spend your attention.

If you run an MCP server, you do not have to take our word for any of this. You can check your own in one command, for free, and nothing you send has to leave your machine.

## The one-command check

If your tools/list is reachable over HTTP, point the scanner at it:

```
curl -s "https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview?url=https://YOUR-HOST/mcp"
```

If your server sits behind auth, or is stdio-only, paste the tool definitions in instead. This path reads only what you send and stores nothing:

```
curl -s -X POST https://x402-data-api.sigrunner.workers.dev/scan/mcp/preview \
  -H 'content-type: application/json' \
  -d '{"tools":[ ...your tools/list... ]}'
```

A clean server comes back like this:

```
"tools_scanned": 1,
"issue_count": 0,
"risk_score": 0,
"grade": "A",
"verdict": "clear",
"risk_summary": "No tool-poisoning/injection patterns detected. Clean on static checks."
```

A poisoned one does not hide. Here is a tool whose description quietly instructs the model to read an environment variable and pass it back in a spare field, without telling the user:

```
"issue_count": 1,
"severity_breakdown": { "critical": 1 },
"risk_score": 40,
"grade": "F",
"verdict": "block",
"risk_summary": "1 CRITICAL (tool-poisoning): do not admit this server until resolved."
```

## Reading the result

The grade is ours, not a certification, and the scale is published with every result: A for a risk score of 0 to 9, B for 10 to 29, C for 30 to 49, D for 50 to 69, and F at 70 or above or on any single critical finding. The verdict collapses that into one word your deploy pipeline can act on: clear, review, or block.

Underneath the score, the engine checks five things in the advertised metadata: prompt injection, tool poisoning, data exfiltration patterns, dangerous capabilities, and hidden unicode used to smuggle instructions past a human reader. Those map to OWASP LLM01 and LLM08. Every finding carries the rule that fired and the evidence that tripped it.

## What this check is honest about not doing

The free preview is deliberately blunt. It tells you the count and the severity, and it withholds which tool and the exact evidence. That is the line between a self-serve smoke test and a paid report, and we would rather you know where it is than discover it.

Two deeper limits matter more. First, this is static analysis. It reads the tool surface your server advertises and never invokes a single tool, which means it says nothing about how a tool actually behaves, whether its auth boundary holds, or whether its permissions are scoped the way the description claims. Second, it is a point in time. A tool description is attacker-mutable on every deploy, so a clean scan this morning is not a clean server this afternoon. That is why our census finding that almost nothing is poisoned today does not mean the risk is gone. It means the risk is drift.

## Where the real work is

When we looked past the count at what the readable servers actually expose, about four in five were exactly what a public registry should be: read-only lookups. The other fifth advertised a sensitive surface to anonymous callers, things in the shape of secret retrieval, key issuance, banking data and account deletion. For that minority, a one-shot CLEAR is not the end of the question. The surface that describes money movement or credential access is the surface worth watching on every connect, and the behavior behind it is worth testing by a person, not a regex.

That is the work we do as an engagement. A scoped assessment tests the live behavior and the auth and permission boundaries the static scan cannot reach, gives you severity-scored findings with reproduction and remediation, an executive summary for leadership, and a free re-test after you ship the fixes. We work only against assets you own or have explicitly authorized, agreed in a scoping call first.

Run the free check on your own server today. If you ship agents or MCP servers that touch credentials, money or customer data and you want the behavior tested, not just the surface read, the scoping call is at /security-assessment. Continuous drift monitoring, so clean stays clean through every deploy, is 9.99 a month at /pricing.
