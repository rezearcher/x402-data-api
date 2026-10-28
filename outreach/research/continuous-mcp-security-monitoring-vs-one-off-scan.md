# Your MCP server passed a security scan. That was true for exactly one release.

A point-in-time MCP scan answers one question: *is this tool manifest clean right now?* It says nothing about the manifest you ship next Tuesday — the one where a new tool arrives with a description that quietly instructs the model, a read-only tool gains a write path, or a dependency rewrite changes what a tool actually does. The attack surface of an MCP server is its **live tool metadata**, and that metadata changes every time you deploy. A scan from last week is a photograph of a thing that moves.

This is the gap between a *scan* and *monitoring*, and it is the whole reason continuous security exists as a category. Grey Ridge Signals runs the monitoring half for the servers **you publish** — a hosted re-scan of your deployed endpoint on a fixed cadence, a webhook alert the release your posture regresses, and a public badge your users can see flip. Static LLM01 (prompt injection) / LLM08 (tool poisoning) detection plus Claude Connector Directory structural checks — re-run, not run-once.

## The snapshot problem, in our own corpus

We scanned 144 public MCP servers for injection and tool-poisoning patterns. Here is what "clean" looks like today:

```
Injection grade across 144 public MCP servers (scanned 2026-10-27)
  Grade A (top band)  ████████████████████████████████████████  143
  Grade B             ▏                                            1
  Every server with a measurable risk score:  risk_score 0
```

That looks like a solved problem. It is not — it is a *moment*. Every one of those 143 clean servers is one `git push` away from a regression, and a snapshot taken today cannot catch a tool that ships tomorrow. The directory side tells the same story from the other direction: of the 144, **58 are Directory-ready and 86 are not** — 986 structural blockers in total, ~11.5 per not-ready server — and readiness moves every release too, usually the wrong way as tools get added faster than they get documented.

*(Sources: our published scorecard index, `scorecard-index.json`, updated 2026-10-27; grade band A = risk_score 0–9 on the Grey Ridge MCP security scale, our grade, not a third-party certification.)*

## What a re-scan actually watches

When a server is monitored, we re-scan its live JSON-RPC endpoint **every 6 hours — four times a day** (Worker cron `0 */6 * * *`) and diff two independent axes:

**1. Security-posture fingerprint.** A deliberately coarse hash of `verdict + risk_score + tool count + the sorted set of (tool | rule | severity) finding classes`. A cosmetic reword of the same finding does **not** page you. But *any* new finding class, a dropped finding, a severity shift, a verdict moving `clear → review → block`, or a change in tool count trips it. That is the "a new tool shipped carrying an injection payload" signal.

**2. Claude Directory readiness.** Tracked on a *separate* axis — ranked `ready → needs_polish → likely_reject` — because a release can break Directory readiness (a new write-capable tool, a dropped hint) while the injection posture is unchanged. We report the regression direction and the exact structural blocker classes that appeared or resolved, so "your next release silently broke Directory readiness" is a first-class alert, not something you discover ~20 days into a review queue.

When either axis moves, the alert is routed by **which** axis moved — `scan_verdict_changed`, `directory_readiness_changed`, or `scan_posture_and_directory_changed` — and delivered to your registered webhook so your own automation can act on it. Every transition is appended to a bounded history ring (the last 50), so a subscriber sees a posture **timeline**, not just the latest snapshot.

### Monitoring you can trust means not crying wolf

Continuous monitoring is only useful if the alerts are real. Two rules, built in:

- The baseline is established **silently** on the first successful scan — establishing a baseline is not "drift," so you never get paged on day one.
- A scan **error never mutates the baseline and never fires an alert.** If your server is briefly unreachable, that is a transient outage, not a regression — we record the timestamp and wait. You get paged when your posture *changes*, not when our fetch hiccups.

## How this is different from the drift tools you already know

A wave of MCP drift tooling shipped this year, and it is good — but almost all of it protects the person *connecting to* servers, run from their own machine or CI:

- **[mcpsweep](https://pypi.org/project/mcpsweep/)** baselines and diffs your configured servers locally, exiting non-zero on drift.
- **[mcp-watch](https://mcpcat.io/guides/detecting-tool-poisoning-attacks-mcp-watch/)** adds a watch mode and pre-commit blocking.
- **[AgentGate](https://github.com/wookat/agentgate)** pins the tool surface in a lockfile and fails CI on drift.
- The broader category — the [CSA RiskRubric note](https://labs.cloudsecurityalliance.org/agentic/csa-research-note-riskrubric-mcp-scanner-spec-20260327/) calls tool poisoning the most frequently observed active exploitation technique against agentic deployments, and SAST/SCA [miss it](https://www.softwareseni.com/tool-poisoning-rug-pulls-and-the-mcp-attack-classes-conventional-scanners-miss) because it lives in runtime metadata, not code.

All of those are **consumer-side**: the agent operator runs them to defend themselves. Grey Ridge is the **supply-side** signal — the one the *author* gives their users. You publish a server; we host the re-scan of your deployed endpoint, page you when it regresses, and issue a **public badge** that re-checks on every render and flips red the release a new tool breaks posture — **before** your users or a Directory reviewer sees it. No lockfile to maintain, no CI to wire, nothing for your users to install to trust you. That is the half the run-it-yourself tools structurally cannot cover, and it is the half that markets your server for you.

Classic web DAST (Detectify, Probely) re-scans continuously but is generic HTTP, not MCP-tool-poisoning-aware. Inline guardrails (Lakera) filter traffic at runtime but are not a public trust signal a publisher can show. We are narrow on purpose: MCP tool-manifest posture + Directory readiness, re-run on a schedule, surfaced as a badge.

## Honest scope

This is **static LLM01/LLM08 detection plus Directory structural checks, re-scanned** — not a penetration test, not a runtime firewall, not a guarantee. "Clear" means no tool-poisoning or injection patterns matched on static analysis of the current manifest; it does **not** mean "safe." What we promise is narrow and real: we will tell you, within hours, the release your posture or your Directory readiness changes, and we will show your users a badge that reflects the current truth rather than a stale photograph.

## Start clean, stay clean

The free scan is live and gives you the current snapshot plus an embeddable badge:

- **Free scan + badge:** `https://api.greyridgesignals.ai/scan/mcp/preview?url=<your-mcp-server>` — grade, verdict, Directory readiness, and a README badge, no account.
- **Keep it live:** continuous monitoring + drift alerts + the full itemized report is **$9.99/mo** at `https://api.greyridgesignals.ai/pricing?ref=greyridge` — your key runs 100 scans across every endpoint, so you re-check each release before you ship it. (Agents can pay per scan over x402 instead: `POST /scan/mcp` is $0.05, zero-egress paste mode.)

A scan tells you the manifest was clean once. Monitoring is the part that stays true. [Run the free scan](https://api.greyridgesignals.ai/scan/mcp-scanner?ref=greyridge), embed the badge, and pin it live.
