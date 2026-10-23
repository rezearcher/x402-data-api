# Loop Control Center — build plan

A single-page ops console to watch the autonomous money loop: what each agent is doing, a running history, the three health lamps (green / super-green / ever-green) tied to *real* checks, live links to the work as it ships, revenue, and a one-click monitor toggle that runs the inspect-and-repair loop (what Claude does by hand) — with self-heal covering when it's off.

## 0b. Existing monitoring to BUILD ON (found 2026-10-23, from the 1Password-era build)

Monitoring already exists — adopt it, don't fork it:
- **`shared-sensor-store`** (skill): `~/.hermes/data/<name>/latest.json` (`fetched_at/status/summary/alert`), read by BOTH Hermes + Claude Code, surfaced in the wake-brief/Daily Brief. This is the monitoring spine.
- **Healthchecks → `hermes-self-heal` → project-liveness** ("5 sensors green", 2026-10-19) = the self-heal FLOOR for when the monitor toggle is OFF (exactly what Rez meant).
- **`hermes-dashboard` :9119 + `fleet-monitor` :9120** = existing general web observability.

**Consequence for this build:** the loop's health (green/super-green/ever-green) is emitted as a **shared sensor** `~/.hermes/data/loop-money/latest.json` in the latest.json convention — so the existing Daily Brief / self-heal ALSO see loop health (one spine, two consumers, per the skill's parity rule). The control-center page is the money-loop-specific *view* on top of that sensor + the per-agent ledgers; the OFF-state floor is the existing `hermes-self-heal`, not a new mechanism.

## 0. Adopt-before-invent (what already exists)

- **Serving pattern:** local python servers already run dashboards (`hermes-dashboard` :9119, `fleet-monitor` :9120, several on 87xx/88xx). We follow that: a small local server + systemd user unit on a dedicated port (proposed **:9123**, localhost-bound).
- **Data already produced (page is a reader, not a new pipeline):**
  - per-agent work: `~/.claude/goal-loop-logs/chain-money-{research,builder,marketing}/progress.ledger.md` (the "what it did / learned / next" history) + `history/*.jsonl` (live transcript = "what it's talking about now").
  - loop rhythm: `~/.claude/agent-chain-logs/money.routine.log` (pass/stage timestamps) + `money/chain.ledger.md` (per-pass wallet deltas).
  - revenue: `~/.hermes/data/x402-revenue/latest.json` (Line A wallet) + `fiat_latest.json` (Line B Stripe).
  - links to work: `outreach/channel_post_ledger.jsonl` (published /research URLs), git log (commits), crew_stage candidate, `docs/reports/SELF_ASSESSMENT.md`.
  - emails interacted: the gmail MCP / outreach logs (send-gate ledger) — surfaced as a "contacts touched" list.

## 1. Architecture (the how)

```
loop artifacts (files/JSON on disk)
        │  (read-only, every ~5s)
        ▼
state_builder.py  ──►  /api/state  (one JSON: agents[], chain[], health{}, revenue{}, links[], emails[], monitor{})
        │                         ▲ polled by the SPA every 3–5s
        ▼                         │
server.py (stdlib http, :9123, 127.0.0.1)  ──►  index.html (single-page SPA, no build step)
        │
        └── POST /api/monitor {on|off}  ──►  writes ~/.claude/agent-chains/monitor.flag
                                               a monitor daemon reads the flag (see §4)
```
No framework/build step: stdlib `http.server` + a static `index.html` using Tailwind (CDN, pinned) + vanilla JS `fetch` polling. Keeps it one file to serve, fast, and dependency-light like the other local servers.

## 2. Health lamps — real checks, not decoration (the point Rez made)

Each lamp is computed from live data and WRITTEN OUT as the `loop-money` shared sensor (§0b) so the Daily Brief/self-heal see it too; the page reads that sensor. A lamp is lit ONLY when its check passes, and the page shows *why*:
- **GREEN — "it's running":** engine process alive AND a pass completed within the last (pass_run + pass_cooldown + slack). Off = stalled/down.
- **SUPER-GREEN — "quality holds":** last N passes shipped real, verified work (builder commit that deployed; marketing publish verified-live 200; no self-attestation) AND the competitor-bar grade is present. Off = green-but-hollow (ran, but output not competitor-grade / unverified).
- **EVER-GREEN — "rhythm holds":** pass cadence within the expected band (run 15–30m, rest ~10m) AND no stage hung/do-nothing. Rendered as a live **waveform of recent pass durations** (the "song"), so you *see* the tempo, not just a dot. Off = off-tempo (long dead air, or a stalled note).

Encoded by FORM, not just color: green = steady dot, super-green = filled ring around it, ever-green = the pulsing waveform. (Avoids the generic 3-identical-lamps look; each state reads differently.)

## 3. Layout (ASCII wireframe)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ GREY RIDGE · LOOP          ● green   ◉ super-green   ∿ ever-green   [MONITOR ▸]│  status bar
│ research ──▶ builder ──▶ marketing ──▶ (rest ∿∿∿)        Line A $0.77 · B $0.00│  chain + revenue strip
├────────────────────┬────────────────────┬───────────────────────────────────┤
│ RESEARCH / GM       │ BUILDER            │ MARKETING                          │
│ NOW: <live line>    │ NOW: <live line>   │ NOW: <live line>                   │  3 agent columns
│ ─ history ────────  │ ─ history ───────  │ ─ history ──────────────────────  │  (NOW card + scrolling
│ • pass N: did…      │ • commit abc: …    │ • published /research/… (200) ↗   │   history, newest top)
│ • pass N-1: …       │ • deployed ✓       │ • …                                │
├────────────────────┴────────────────────┴───────────────────────────────────┤
│ WORK SHIPPED (links, newest first)        │ CONTACTS TOUCHED                   │
│ ↗ /research/scan-your-own-mcp-server 200  │ drvelvetfog (reply)                │  links + emails panels
│ ↗ commit 9f98484 deploy✓                  │ miles@… (free scan)                │
├───────────────────────────────────────────────────────────────────────────┤
│ MONITOR CONSOLE  [●on/off]   last check 14:40 · next 15:10 · repairs: 1       │  monitor toggle + its
│ > research stage clean; builder shipped ef2ecd1 (deployed); rest 10m ✓        │  own activity feed
└───────────────────────────────────────────────────────────────────────────┘
```
Left-aligned, dense-but-calm. Three columns are the hero (the three agents working side by side is the thing you came to see).

## 4. Monitor toggle (the button)

- `POST /api/monitor {on}` writes `~/.claude/agent-chains/monitor.flag`.
- A `loop-monitor.daemon` (systemd user unit + a small driver) watches the flag: when ON, every 30 min it runs a headless Claude monitor-agent (own prompt + the inspect/repair playbook — exactly what Claude does now: read ledgers, grade quality vs competitors, check rhythm, fix stalls to maintain forward momentum) and streams its findings to `~/.claude/agent-chain-logs/monitor.feed.jsonl`, which the console panel tails.
- When OFF: the existing self-heal (`hermes-self-heal` / routine relaunch + give-up watcher) is the floor; the console shows "monitor off — self-heal active."
- The monitor-agent is itself an enabler (no hard blocks; targeted catches only) per [[feedback_enabler_not_hard_blocks_targeted_antigaming]].

## 5. Design tokens (distinctive, not the generic defaults)

Concept: **a signals desk** — Grey Ridge reads signals; this reads the loop's vitals; rhythm is a literal trace. Deliberately NOT black+acid-green terminal (the AI-dashboard cliché) and NOT cream+terracotta.
- **Color (ink + instrument):** base `#0E1522` (deep ink-navy), panel `#16202E`, hairline `#243245`, text `#C9D4E0`, muted `#6E8099`; signals — healthy `#54B98A` (jade, not acid), attention `#E8B04B` (amber), live-trace `#5BC9D6` (cyan, used only for the waveform). One accent family, forms carry the rest.
- **Type (2 families):** display/UI **Space Grotesk** (technical character without being a terminal font); **IBM Plex Mono** used ONLY for real telemetry values (timestamps, $, durations) where monospace is honest, never for labels.
- **Layout:** fixed status bar; CSS grid 3-col agent board; panels are quiet (hairline borders, minimal radius), the waveform + the live NOW lines are where the energy goes. One orchestrated motion: the ever-green waveform animates; everything else still.
- **Principles:** real data or it's not shown; forms encode state (dot/ring/wave); one memorable element (the rhythm trace); quiet everywhere else.

## 6. Build phases

1. `state_builder.py` — pure reader → the `/api/state` JSON (all sources in §0). Testable alone (`python state_builder.py | jq`).
2. `server.py` — stdlib http on 127.0.0.1:9123, serves `index.html` + `/api/state` + `POST /api/monitor`.
3. `index.html` — the SPA to the §5 tokens / §3 layout; polls `/api/state`.
4. `loop-control-center.service` (systemd user unit) — keep it up.
5. Monitor daemon + flag + monitor-agent prompt (§4); wire the console feed.
6. Polish pass: screenshots, tighten against the design critique, mobile/responsive floor.

## 7. Open choices for Rez (fast)

- Port 9123 + localhost-only (safe default) vs. reachable on the LAN. Default: localhost.
- Is this the money loop only (now), or built generic to add the arb loop later? Default: money loop now, structured so a second loop is a tab later.
