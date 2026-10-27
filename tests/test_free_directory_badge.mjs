/**
 * Contract tests for the LIVE Claude Directory-readiness badge handed to an
 * UNCLAIMED connector author in the free scan output (src/index.ts: previewOf
 * badge_markdown + the kind=directory live-scan branch of /scan/verify/badge).
 *
 *   node tests/test_free_directory_badge.mjs
 *
 * The distribution play: every free scan of a public MCP URL now hands back an
 * embeddable badge that re-checks the server live and links to the full report,
 * so each README embed is a backlink + billboard — not a grey placeholder that
 * only lights up after a paid claim. These assertions pin:
 *   - badge_markdown is emitted ONLY when a full http(s) badgeTarget is passed
 *     (URL-based free scan), never on paste-mode (no URL to re-scan).
 *   - the badge points at kind=directory&url=<target> (live one-shot) and links
 *     to the report, both on the canonical public base, properly URL-encoded.
 *   - the free teaser still withholds WHICH criteria fail (paid remediation).
 * Node >= 22.18 strips types; cloudflare:workers is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { previewOf } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

const cleanResult = {
  target: "https://acme.example/mcp",
  tools_scanned: 3,
  findings: [],
  risk_score: 0,
  verdict: "clear",
  risk_summary: "no issues",
  scanned_at: new Date().toISOString(),
};
const readyDir = { ready: true, status: "ready", blocker_count: 0, hard_blockers: 0, soft_blockers: 0 };
const rejectDir = { ready: false, status: "likely_reject", blocker_count: 2, hard_blockers: 2, soft_blockers: 0 };
const TARGET = "https://acme.example/mcp";
const ENC = encodeURIComponent(TARGET);

check("URL-based free scan emits an embeddable directory badge_markdown", () => {
  const out = previewOf(cleanResult, readyDir, TARGET);
  const dr = out.directory_readiness;
  assert.ok(dr, "directory_readiness present");
  assert.ok(typeof dr.badge_markdown === "string" && dr.badge_markdown.length > 0, "badge_markdown present");
  assert.ok(typeof dr.badge_note === "string" && dr.badge_note.length > 0, "badge_note present");
});

check("badge points at the LIVE kind=directory scan of the exact URL", () => {
  const dr = previewOf(cleanResult, readyDir, TARGET).directory_readiness;
  // The shields endpoint url must carry kind=directory&url=<encoded target>.
  assert.ok(dr.badge_markdown.includes("img.shields.io/endpoint"), "uses shields endpoint badge");
  assert.ok(dr.badge_markdown.includes("kind%3Ddirectory"), "kind=directory in encoded endpoint url");
  assert.ok(dr.badge_markdown.includes(encodeURIComponent("url=" + ENC)) || dr.badge_markdown.includes("url%3D" + encodeURIComponent(ENC)), "live target url carried into badge endpoint");
});

check("badge links to the full report for the same target (the funnel)", () => {
  const dr = previewOf(cleanResult, rejectDir, TARGET).directory_readiness;
  assert.ok(dr.badge_markdown.includes("/scan/report?url=" + ENC), "links to report page for the target");
  assert.ok(dr.badge_markdown.startsWith("[![Claude Directory readiness]"), "renders as a linked README badge");
});

check("paste-mode (no URL) emits NO badge — nothing live to re-scan", () => {
  const dr1 = previewOf(cleanResult, readyDir).directory_readiness; // no badgeTarget
  assert.ok(dr1 && dr1.badge_markdown === undefined, "no badge without a target url");
  const dr2 = previewOf(cleanResult, readyDir, "not-a-url").directory_readiness;
  assert.ok(dr2 && dr2.badge_markdown === undefined, "no badge for a non-http target");
});

check("free teaser still withholds the itemized criteria (paid remediation)", () => {
  const dr = previewOf(cleanResult, rejectDir, TARGET).directory_readiness;
  assert.strictEqual(dr.blockers, undefined, "free teaser never lists WHICH criteria");
  assert.ok(/pricing|subscribe|monitor/i.test(dr.upsell), "teaser carries the conversion upsell");
});

console.log(`\n${pass} checks passed`);
