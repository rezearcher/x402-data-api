/**
 * Contract tests for the /scan/report security-posture TIMELINE card
 * (src/index.ts: renderPostureTimeline).
 *
 *   node tests/test_posture_timeline.mjs
 *
 * The timeline is the continuous-monitoring HISTORY Detectify/Probely sell — not
 * a single re-check but a dated record of every verdict/risk transition. These
 * assertions pin the gating so the paid (monitored) subscriber gets the full
 * dated list while a free verified-only owner gets a locked teaser + upsell, and
 * an unclaimed/unscanned server gets NOTHING (we never fabricate a history).
 * Node >= 22.18 strips types; the virtual cloudflare:workers module is shimmed by
 * cfw-hooks.mjs (same as the verify/sized-verdict suites). renderPostureTimeline
 * is a real export from the Worker module — this tests the shipped code.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { renderPostureTimeline } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

const HIST = [
  { at: "2026-10-01T08:00:00.000Z", kind: "baseline", verdict: "clear", risk_score: 0, tools_scanned: 3, by_severity: { critical: 0, high: 0, medium: 0, low: 0 } },
  { at: "2026-10-12T14:30:00.000Z", kind: "changed", verdict: "review", risk_score: 28, tools_scanned: 4, by_severity: { critical: 0, high: 0, medium: 2, low: 1 } },
  { at: "2026-10-20T06:00:00.000Z", kind: "changed", verdict: "block", risk_score: 72, tools_scanned: 4, by_severity: { critical: 1, high: 1, medium: 0, low: 0 } },
];
const SNAP = { fp: "abc", verdict: "block", risk_score: 72, tools_scanned: 4, by_severity: { critical: 1 }, checked_at: "2026-10-24T06:00:00.000Z" };
const REC = { posture_history: HIST, posture: SNAP };

// 1. Monitored (paid) → full dated timeline with every transition + latest snapshot.
check("monitored renders full dated timeline", () => {
  const html = renderPostureTimeline({ ownerRec: REC, monitored: true, ownerHost: "mcp.example.com" });
  assert.match(html, /Security posture over time/);
  assert.match(html, /pill clear">monitored/);
  assert.ok(html.includes("2026-10-01 08:00 UTC"), "baseline date rendered");
  assert.ok(html.includes("2026-10-12 14:30 UTC"), "change #1 date rendered");
  assert.ok(html.includes("2026-10-20 06:00 UTC"), "change #2 date rendered");
  assert.ok(html.includes("72/100"), "risk score rendered");
  assert.ok(html.includes("1 critical, 1 high"), "severity mix rendered");
  assert.ok(html.includes("Last re-checked 2026-10-24 06:00 UTC"), "latest snapshot rendered");
  assert.ok(html.includes("3 recorded transition(s), 2 verdict/risk change(s)"), "counts correct");
  // newest-first: the block verdict row should appear before the baseline row.
  assert.ok(html.indexOf("2026-10-20 06:00") < html.indexOf("2026-10-01 08:00"), "newest-first order");
});

// 2. Verified-only (free) → locked teaser: count + current verdict + upsell, NO dated rows.
check("verified-only renders locked teaser + upsell, no dated rows", () => {
  const html = renderPostureTimeline({ ownerRec: REC, monitored: false, ownerHost: "mcp.example.com" });
  assert.match(html, /timeline locked/);
  assert.ok(html.includes("<strong>3</strong> posture transition(s)"), "count shown");
  assert.ok(html.includes("2 verdict/risk change(s)"), "change count shown");
  assert.ok(html.includes("Turn on monitoring — $9.99/mo"), "upsell present");
  assert.ok(html.includes("/scan/verify?domain=mcp.example.com"), "upsell links to claim/verify");
  // The locked teaser must NOT leak the dated transition list.
  assert.ok(!html.includes("2026-10-12 14:30"), "dated change rows withheld");
  assert.ok(!html.includes("<table"), "no timeline table in locked view");
});

// 3. No history → empty string (never fabricate a timeline).
check("no history returns empty", () => {
  assert.strictEqual(renderPostureTimeline({ ownerRec: { posture_history: [] }, monitored: true, ownerHost: "x.com" }), "");
  assert.strictEqual(renderPostureTimeline({ ownerRec: null, monitored: true, ownerHost: "x.com" }), "");
  assert.strictEqual(renderPostureTimeline({ ownerRec: undefined, monitored: false, ownerHost: "x.com" }), "");
});

// 4. History present but no ownerHost (can't link a claim) → empty.
check("missing ownerHost returns empty", () => {
  assert.strictEqual(renderPostureTimeline({ ownerRec: REC, monitored: true, ownerHost: null }), "");
});

// 5. HTML-escaping: a hostile host string must not break out of the attribute/markup.
check("ownerHost is escaped", () => {
  const html = renderPostureTimeline({ ownerRec: REC, monitored: false, ownerHost: 'a"<b>' });
  assert.ok(!html.includes('a"<b>'), "raw hostile host not present");
  assert.ok(html.includes("a&quot;&lt;b&gt;"), "host escaped in body");
});

// 6. Monitored with only a baseline (no changes yet) → timeline with the single baseline row.
check("baseline-only monitored shows single row, 0 changes", () => {
  const rec = { posture_history: [HIST[0]], posture: { verdict: "clear", risk_score: 0, checked_at: "2026-10-01T08:05:00.000Z" } };
  const html = renderPostureTimeline({ ownerRec: rec, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(html.includes("1 recorded transition(s), 0 verdict/risk change(s)"), "counts correct for baseline-only");
  assert.ok(html.includes("pill unknown\" style=\"font-size:.7rem\">baseline"), "baseline event pill");
});

// 7. Per-rule diff: monitored timeline expands each "changed" transition with the
// exact findings that appeared / resolved (the Detectify-parity per-finding history).
check("monitored renders per-rule added/resolved diff", () => {
  const HC = [
    { at: "2026-10-01T08:00:00.000Z", kind: "baseline", verdict: "clear", risk_score: 0, tools_scanned: 3, by_severity: {}, classes: [] },
    { at: "2026-10-12T14:30:00.000Z", kind: "changed", verdict: "review", risk_score: 28, tools_scanned: 4, by_severity: { medium: 1 }, classes: ["web_fetch|untrusted-content|medium"] },
    { at: "2026-10-20T06:00:00.000Z", kind: "changed", verdict: "block", risk_score: 72, tools_scanned: 4, by_severity: { critical: 1 }, classes: ["exec|shadowing|critical"] },
  ];
  const html = renderPostureTimeline({ ownerRec: { posture_history: HC, posture: { verdict: "block", risk_score: 72, checked_at: "2026-10-24T06:00:00.000Z" } }, monitored: true, ownerHost: "mcp.example.com" });
  // change #1 added a finding that was not in the baseline
  assert.ok(html.includes("1 new finding(s)"), "added-count rendered");
  assert.ok(html.includes("untrusted-content"), "added rule label rendered");
  // change #2 both added the critical AND resolved the medium from change #1
  assert.ok(html.includes("shadowing"), "second-change added rule rendered");
  assert.ok(html.includes("1 resolved"), "resolved-count rendered");
});

// 8. Degrade cleanly on legacy history that predates classes (no diff, no crash).
check("legacy history without classes renders no diff rows, no throw", () => {
  const html = renderPostureTimeline({ ownerRec: REC, monitored: true, ownerHost: "mcp.example.com" });
  assert.match(html, /Security posture over time/);
  assert.ok(!html.includes("new finding(s)"), "no diff fabricated when classes absent");
});

// 9. Risk-score sparkline: monitored timeline with >=2 datapoints renders an inline
// SVG trend (the Detectify/Probely at-a-glance posture graph) with the correct
// trend verb; the free locked view and <2-point histories render no SVG.
check("monitored renders risk-score sparkline SVG with trend", () => {
  const html = renderPostureTimeline({ ownerRec: REC, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(html.includes("<svg"), "inline SVG sparkline present");
  assert.ok(html.includes("<polyline"), "trend polyline present");
  assert.ok(html.includes("Risk score (0–100) over the last"), "sparkline caption present");
  // HIST goes 0 -> 28 -> 72, so posture worsened.
  assert.ok(html.includes("worsened"), "trend verb reflects rising risk");
  assert.ok(html.includes("<strong>72/100</strong>"), "latest risk in caption");
});

check("locked (free) view renders no sparkline SVG", () => {
  const html = renderPostureTimeline({ ownerRec: REC, monitored: false, ownerHost: "mcp.example.com" });
  assert.ok(!html.includes("<svg"), "no SVG in locked teaser");
});

check("baseline-only (single datapoint) renders no sparkline", () => {
  const rec = { posture_history: [HIST[0]], posture: { verdict: "clear", risk_score: 0, checked_at: "2026-10-01T08:05:00.000Z" } };
  const html = renderPostureTimeline({ ownerRec: rec, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(!html.includes("<svg"), "no sparkline with <2 datapoints");
});

// 10. Letter-grade column: the monitored timeline renders a per-transition grade
// recomputed from each row's risk_score + critical count (mcpGrade), so the
// human-legible A-F signal is on the public report, not only the webhook/status.
// HIST: baseline risk 0/crit 0 -> A, change risk 28 -> B, change risk 72/crit 1 -> F.
check("monitored renders a per-transition letter grade column", () => {
  const html = renderPostureTimeline({ ownerRec: REC, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(html.includes("<th>Grade</th>"), "grade column header present");
  // the F row (risk 72, 1 critical) renders a bold F cell
  assert.ok(html.includes('<td style="font-weight:700">F</td>'), "F grade cell rendered for the block row");
  assert.ok(html.includes('<td style="font-weight:700">A</td>'), "A grade cell rendered for the clean baseline row");
  assert.ok(html.includes('<td style="font-weight:700">B</td>'), "B grade cell rendered for the mid row");
});

// 11. Grade trend: first->last letter move across the window via mcpGradeDelta,
// shown as "A -> F ... regressed N bands" (the crawlable version of the drift
// signal the monitoring webhook pushes). HIST A->F = regressed 4 bands.
check("monitored renders a grade-trend line (A -> F, regressed)", () => {
  const html = renderPostureTimeline({ ownerRec: REC, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(html.includes("Grade trend:"), "grade-trend line present");
  assert.ok(html.includes("A → F"), "first->last grade move rendered");
  assert.ok(html.includes("regressed 4 bands"), "regression magnitude rendered");
});

// 12. Grade-trend degrades to nothing with a single graded datapoint (nothing to compare).
check("baseline-only renders no grade-trend line", () => {
  const rec = { posture_history: [HIST[0]], posture: { verdict: "clear", risk_score: 0, checked_at: "2026-10-01T08:05:00.000Z" } };
  const html = renderPostureTimeline({ ownerRec: rec, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(!html.includes("Grade trend:"), "no grade-trend with <2 graded points");
});

// 13. Current grade leads the latest-snapshot line and the free locked teaser so the
// grade (unlike the dated history) is a crawlable signal on both the paid and free view.
check("current grade appears in monitored last-seen line and free teaser", () => {
  const paid = renderPostureTimeline({ ownerRec: REC, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(paid.includes("currently grade <strong>F</strong>"), "monitored last-seen leads with grade");
  const free = renderPostureTimeline({ ownerRec: REC, monitored: false, ownerHost: "mcp.example.com" });
  assert.ok(free.includes("current grade <strong>F</strong>"), "free teaser leads with grade");
  // free teaser still withholds the dated rows
  assert.ok(!free.includes("<th>Grade</th>"), "free teaser has no timeline table");
});

// 14. An improvement renders green + "improved"; a non-finite risk row grades "?" not a fake letter.
check("improving history renders an improved grade-trend; missing risk grades '?'", () => {
  const UP = [
    { at: "2026-10-01T08:00:00.000Z", kind: "baseline", verdict: "block", risk_score: 72, tools_scanned: 4, by_severity: { critical: 1 } },
    { at: "2026-10-10T08:00:00.000Z", kind: "changed", verdict: "review", risk_score: 28, tools_scanned: 4, by_severity: { medium: 2 } },
    { at: "2026-10-20T08:00:00.000Z", kind: "changed", verdict: "clear", risk_score: 0, tools_scanned: 4, by_severity: {} },
  ];
  const html = renderPostureTimeline({ ownerRec: { posture_history: UP, posture: { verdict: "clear", risk_score: 0, checked_at: "2026-10-21T08:00:00.000Z" } }, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(html.includes("F → A"), "improving first->last move rendered");
  assert.ok(html.includes("improved 4 bands"), "improvement magnitude rendered");
  const NR = [
    { at: "2026-10-01T08:00:00.000Z", kind: "baseline", verdict: "clear", risk_score: 0, by_severity: {} },
    { at: "2026-10-10T08:00:00.000Z", kind: "changed", verdict: "unknown", risk_score: null, by_severity: {} },
  ];
  const h2 = renderPostureTimeline({ ownerRec: { posture_history: NR, posture: { verdict: "clear", risk_score: 0, checked_at: "2026-10-11T08:00:00.000Z" } }, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(h2.includes("<td class=muted>?</td>"), "non-finite risk row grades '?', not a fabricated letter");
});

console.log(`\n${pass} checks passed`);
