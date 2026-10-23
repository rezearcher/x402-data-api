A scanner reads what your MCP server advertises. It never calls a single tool. That gap is the whole reason a scan and an assessment are different products, and it is worth being precise about, because a clean scan can lull a team into thinking a question has been answered when it has only been narrowed.

Our free scanner reads the tool list your server hands out: the names, the descriptions, the JSON schemas. From that metadata it flags concealed instructions, exfiltration-shaped parameters, cross-tool name collisions, invisible-unicode smuggling, and over-broad scopes. Those are real failures and catching them early is cheap. But every one of them is a property of what the server says about itself. None of them is a property of what the server does when a model actually calls it.

## Three things the metadata cannot tell you

The first is behavior. A tool described as a read-only lookup can, in its implementation, write. A description is a promise; the code is the fact; a static read only ever sees the promise. The only way to know whether the promise holds is to call the tool under controlled conditions and watch what it touches.

The second is the auth and permission boundary. A tool can carry a perfectly innocent description and still accept a parameter that lets a caller read a record that is not theirs, or escalate past the scope the description implied. Boundary failures do not live in the advertised surface. They live one layer down, in how the server decides who is allowed to do what, and you reach them by testing, not by reading.

The third, for anything that touches Base or another chain, is on-chain exposure. Approval and allowance scope, slippage tolerance, the difference between what a swap route quotes and what it settles. A tool list says none of this. It is behavior under real inputs, and it is exactly the kind of thing that quietly drains a trading agent while every static check stays green.

## Why a scan still earns its place

I am not arguing the scan is worthless. It is the right first move. It is free, it runs in one command, it reads only what you send it, and it catches the class of mistake that is embarrassing to ship and trivial to fix. Run it on your own server today. It will tell you, honestly, whether your advertised surface is clean on the static checks.

What it will not do is tell you that you are safe, because no point-in-time read can, and because a tool description is attacker-mutable on every deploy. A clean scan this morning is a clean surface this morning. That is a real and useful fact. It is just a smaller fact than it looks.

## What the engagement adds

A scoped assessment picks up where the scan stops. We run two to three weeks of static and dynamic testing against the servers, agents, or on-chain integration you nominate: tool metadata, live tool behavior, and the auth and permission boundaries the scan cannot reach. You get severity-scored findings with reproduction steps and concrete remediation, an executive summary for leadership alongside the technical detail for the team, and one free re-test after you ship the fixes. The engagement is 7,500 to 15,000 dollars, with the exact number set by scope at a call, not before it.

If the worry is that clean does not stay clean, that is the monitoring retainer: your servers re-scanned on every change, a CI admission gate that blocks a deploy when a tool drifts to a block verdict, and alerts when a new dependency or tool introduces a known pattern. That runs 3,000 to 5,000 a month.

We test only assets you own or have explicitly authorized, agreed at a scoping call first. Our checks map to the OWASP LLM01 and LLM08 classes and to the tool-poisoning research published by Invariant Labs, with the agent-level and on-chain review done by hand on top.

Start with the free scan. If you ship agents or MCP servers that move money or touch customer data and you want the behavior tested rather than the surface read, the scoping call is at /security-assessment, and continuous drift monitoring is at /pricing.
