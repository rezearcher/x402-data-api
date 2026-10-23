Your MCP server passed a security scan. Then you shipped a new tool, and the scan stopped being true.

A scan reads your server once. It looks at the tool list your server advertised at that moment, checks every tool description against the known prompt-injection and tool-poisoning patterns (OWASP LLM01 and LLM08), and returns a verdict. If the list is clean, you get a clear grade. That grade is accurate for exactly one state of your server: the one that existed the second the scan ran.

Then you keep building. You add a tool. You reword a description. A dependency you pull in registers its own tool at startup. None of that is visible to a scan from last week, and none of it re-runs the check on its own.

## What drift looks like, measured

Here is the same MCP server, scanned twice, using our free read-only endpoint.

Week one, two tools, both benign:

```
grade A | verdict clear | risk 0 | findings 0
```

Week two, same server, same scan. One line was added to a single tool description, the kind of line that creeps in when a tool starts "helpfully" summarizing extra context:

```
grade F | verdict block | risk 40
```

The added text was a conceal-from-user override instruction, a classic tool-poisoning signature. The server did not get re-scanned, because nothing re-scans a server for you. The owner would have kept showing a clean result from the week before. Both scans above ran live against our hosted engine while this was written; you can reproduce them against your own server in your browser.

That gap, between the last time you scanned and the current state of your server, is the whole problem. A point-in-time check cannot cover a change made after it ran. This is not a flaw in scanning. It is what "point in time" means.

## Why the honest tools do not fix this for you

A one-off CLI scanner, the Snyk-style free check included, is genuinely useful and we ship one too. Run it, read the findings, fix them. But it runs when you run it. It has no memory of your last result, no view of what changed, and no way to tell you the day a tool description drifts into something dangerous. The same is true of a pentest or a scoped assessment: it is a deep look at one moment, deliberately. None of these are continuous, and none of them claim to be.

So the honest options for a server you keep shipping are two. Re-run the scan yourself, by hand, after every change and every dependency bump, forever, and remember to. Or have something watch it for you.

## What continuous monitoring actually is

We re-scan subscribed servers on a schedule, keep the previous result, and alert you when the verdict changes. The embeddable badge your users see reflects the current state, not a screenshot from the week you first passed. When a tool description drifts from clear to block, you hear about it from us before your users hit it.

The measurement behind that: over our recent sampling window the scan endpoint answered 759 of 759 probes successfully, a 100% success rate. The window is short, days not months, so read it as a measurement and not a service guarantee. We publish the raw samples and the live numbers at the status page rather than asking you to take the figure on trust.

Scope, stated plainly: this is static detection of prompt-injection and tool-poisoning patterns (LLM01 and LLM08) plus change monitoring. It reads what your server advertises and flags known-dangerous patterns across time. It does not call your tools, does not test your auth boundaries, and does not make your server "safe." It tells you when the thing you already passed stops passing.

## Where this lands

If you publish an MCP server and you keep changing it, a scan result ages the moment you deploy. The free scan is the right place to start and costs nothing: check your own server, read the grade, fix what it flags. The subscription keeps the badge live and sends drift alerts as you ship, for 9.99 a month. For teams running several servers or agents who want a named engagement and a standing watch, the monitoring retainer runs 3,000 to 5,000 a month on top of a scoped assessment.

Scan your server free, in the browser, and see today's grade. Then decide whether you want to be the one re-running it by hand every release.
