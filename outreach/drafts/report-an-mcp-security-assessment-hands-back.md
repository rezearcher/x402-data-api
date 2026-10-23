A clean scan is a good morning. It is not a report. Teams who run our free MCP scanner, see a clear verdict, and then ask what a paid engagement actually produces are asking the right question, because the two things are different artifacts and it is worth knowing exactly what lands in your inbox at the end of one. This is that walkthrough: what a Grey Ridge security assessment hands back, item by item, so you can decide whether it is worth a scoping call before you book one.

## The findings report

The core deliverable is a severity-scored findings report. Every issue we confirm is written up the same way: what it is, where it lives, the exact steps to reproduce it, and concrete remediation that your engineers can act on without a follow-up meeting. A finding without a reproduction is an opinion, so each one carries the inputs and the observed behavior that triggered it. A finding without remediation is a complaint, so each one carries the fix, or the narrowed set of options when the fix is a design choice rather than a one-liner.

Severity is scored so you can triage honestly. A concealed instruction in a tool description that a model will read before it acts is not the same class of problem as a verbose error message, and the report does not pretend they are. You get an order to work in, not a flat list.

## The executive summary

Alongside the technical detail there is an executive summary written for the people who sign off rather than the people who patch. It states what was tested, what was found, what the business exposure is in plain terms, and what the remaining risk looks like after the recommended fixes. Leadership should be able to read one page and understand the posture without reading the whole report, and the engineers should be able to read the rest and start work the same day. Two audiences, one engagement, no translation tax on your team.

## The free re-test

When you ship the fixes, we re-run the relevant tests once at no additional charge and confirm what closed and what did not. This matters more than it sounds. A report that lands and then goes stale the moment you touch the code is a snapshot you paid for and then invalidated yourself. The free re-test turns the engagement into a closed loop: find, fix, verify. You are not left wondering whether the remediation held, and you are not billed again to find out.

## What the testing actually covers

So you know what produced the report: we run two to three weeks of static and dynamic testing against the servers, agents, or on-chain integration you nominate. The static half reads the advertised tool surface for the class of mistake a free scan catches, concealed instructions, exfiltration-shaped parameters, name collisions, invisible-unicode smuggling, over-broad scopes. The dynamic half calls the tools under controlled conditions and watches what they touch, probes the auth and permission boundary a static read cannot reach, and for anything touching Base or another chain reviews approval scope, slippage, and the gap between what a route quotes and what it settles. The scanner reads what the server says about itself; the engagement tests what it does. If you want that distinction in full, it is written up separately under what an assessment tests that a scan cannot.

## The retainer, if clean does not stay clean

A tool description is attacker-mutable on every deploy, so a clean assessment is a clean posture on the day it ran and no longer. If that is the worry, the monitoring retainer is the answer: your servers re-scanned on every change, a CI admission gate that blocks a deploy when a tool drifts to a block verdict, and alerts when a new dependency or tool introduces a known pattern. The findings report tells you where you stand; the retainer keeps it true.

## What it costs, and what it does not promise

The engagement runs 7,500 to 15,000 dollars, with the exact number set by scope at a call rather than guessed before it. The monitoring retainer runs 3,000 to 5,000 a month. We test only assets you own or have explicitly authorized, agreed at a scoping call first, and our checks map to the OWASP LLM01 and LLM08 classes and to the tool-poisoning research published by Invariant Labs, with the agent-level and on-chain review done by hand on top. We do not call the result safe, because no engagement can honestly promise that a system is safe; what we hand back is a tested, reproducible, severity-scored picture of where the exposure is and what closes it.

Start with the free scan to see your static surface. If you ship agents or MCP servers that move money or touch customer data and you want the behavior tested rather than the surface read, the scoping call is at /security-assessment, and continuous drift monitoring is at /pricing.
