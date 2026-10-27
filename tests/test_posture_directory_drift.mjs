/**
 * Contract tests for Claude Directory-readiness DRIFT on monitored MCP hosts
 * (src/index.ts: grsgDirectoryDrift + renderPostureTimeline directory rows).
 *
 *   node tests/test_posture_directory_drift.mjs
 *
 * The monitored subscription sells a per-release Directory-readiness re-check:
 * "a new tool in your next release silently broke your Directory readiness."
 * A readiness change frequently has NO injection-finding delta, so it needs its
 * own drift axis and its own timeline row. These assertions pin:
 *   - grsgDirectoryDrift returns null on the first (pre-directory) baseline so a
 *     Worker upgrade never fires a false alert on existing records.
 *   - a status regression / new structural blocker counts as worsened drift.
 *   - an improvement counts as drift but NOT worsened.
 *   - the monitored timeline renders the readiness regression row; the free
 *     (locked) view never leaks it.
 * Node >= 22.18 strips types; cloudflare:workers is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { grsgDirectoryDrift, renderPostureTimeline } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

// --- grsgDirectoryDrift pure logic -----------------------------------------

check("no prior directory snapshot -> null (silent re-baseline, no false alert)", () => {
  assert.strictEqual(grsgDirectoryDrift(undefined, { status: "ready", blocker_count: 0, classes: [] }), null);
  assert.strictEqual(grsgDirectoryDrift({}, { status: "likely_reject", blocker_count: 2, classes: ["t|directory:mixed-read-write"] }), null);
});

check("identical readiness -> not drifted", () => {
  const d = grsgDirectoryDrift(
    { status: "ready", classes: [] },
    { status: "ready", blocker_count: 0, classes: [] },
  );
  assert.ok(d && d.drifted === false && d.worsened === false, "steady readiness is no drift");
});

check("status regression ready -> likely_reject is worsened drift", () => {
  const d = grsgDirectoryDrift(
    { status: "ready", classes: [] },
    { status: "likely_reject", blocker_count: 1, classes: ["transfer|directory:mixed-read-write"] },
  );
  assert.ok(d.drifted, "drifted");
  assert.ok(d.worsened, "worsened");
  assert.match(d.reason, /regressed ready -> likely_reject/);
});

check("new structural blocker with same status is worsened drift", () => {
  const d = grsgDirectoryDrift(
    { status: "needs_polish", classes: ["a|directory:missing-title"] },
    { status: "needs_polish", blocker_count: 2, classes: ["a|directory:missing-title", "b|directory:missing-hint"] },
  );
  assert.ok(d.drifted && d.worsened, "a new blocker class worsens readiness");
  assert.match(d.reason, /New Directory structural blocker/);
  assert.match(d.reason, /missing-hint/);
});

check("improvement likely_reject -> ready is drift but NOT worsened", () => {
  const d = grsgDirectoryDrift(
    { status: "likely_reject", classes: ["x|directory:mixed-read-write"] },
    { status: "ready", blocker_count: 0, classes: [] },
  );
  assert.ok(d.drifted, "an improvement is still a recordable change");
  assert.ok(!d.worsened, "an improvement is not a worsening");
  assert.match(d.reason, /improved likely_reject -> ready/);
});

// --- renderPostureTimeline directory row ------------------------------------

const DIR_HIST = [
  {
    at: "2026-10-01T08:00:00.000Z", kind: "baseline", verdict: "clear", risk_score: 0, tools_scanned: 3,
    by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, classes: [],
    directory: { status: "ready", hard_blockers: 0, soft_blockers: 0, classes: [] },
  },
  {
    // Security posture UNCHANGED (still clear, risk 0) but a new write-capable
    // tool broke Directory readiness — the exact per-release signal a one-shot
    // scan misses. The timeline must still surface it.
    at: "2026-10-18T09:00:00.000Z", kind: "changed", verdict: "clear", risk_score: 0, tools_scanned: 4,
    by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, classes: [],
    directory: { status: "likely_reject", hard_blockers: 1, soft_blockers: 0, classes: ["send_tx|directory:mixed-read-write"] },
  },
];
const DIR_SNAP = { fp: "z", verdict: "clear", risk_score: 0, tools_scanned: 4, by_severity: { critical: 0 }, checked_at: "2026-10-24T09:00:00.000Z", directory: { status: "likely_reject", blocker_count: 1, hard_blockers: 1, soft_blockers: 0, classes: ["send_tx|directory:mixed-read-write"] } };
const DIR_REC = { posture_history: DIR_HIST, posture: DIR_SNAP };

check("monitored timeline surfaces Directory readiness regression row", () => {
  const html = renderPostureTimeline({ ownerRec: DIR_REC, monitored: true, ownerHost: "mcp.example.com" });
  assert.match(html, /Claude Directory/, "directory axis labelled");
  assert.match(html, /ready → likely_reject/, "readiness status arrow rendered");
  assert.match(html, /new reject/, "new structural blocker counted");
  assert.match(html, /mixed-read-write/, "the specific rule named");
});

check("free (locked) view never leaks the Directory regression detail", () => {
  const html = renderPostureTimeline({ ownerRec: DIR_REC, monitored: false, ownerHost: "mcp.example.com" });
  assert.match(html, /timeline locked/);
  assert.ok(!html.includes("ready → likely_reject"), "locked view hides the dated directory diff");
  assert.ok(!html.includes("mixed-read-write"), "locked view hides the specific rule");
});

check("legacy history without a directory field renders no directory row, no throw", () => {
  const legacy = [
    { at: "2026-09-01T08:00:00.000Z", kind: "baseline", verdict: "clear", risk_score: 0, tools_scanned: 3, by_severity: { critical: 0 }, classes: [] },
    { at: "2026-09-10T08:00:00.000Z", kind: "changed", verdict: "review", risk_score: 20, tools_scanned: 3, by_severity: { medium: 2 }, classes: ["a|untrusted-content|medium"] },
  ];
  const html = renderPostureTimeline({ ownerRec: { posture_history: legacy, posture: { checked_at: "2026-09-10T08:00:00.000Z", verdict: "review", risk_score: 20 } }, monitored: true, ownerHost: "mcp.example.com" });
  assert.ok(!html.includes("Claude Directory"), "no directory row without directory data");
  assert.match(html, /Security posture over time/, "still renders the security timeline");
});

console.log(`\n${pass} checks passed`);
