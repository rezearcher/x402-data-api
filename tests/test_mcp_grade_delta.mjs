/**
 * Contract test for the MCP monitoring grade-delta drift signal.
 *
 *   node tests/test_mcp_grade_delta.mjs
 *
 * mcpGradeDelta turns two A-F posture grades (A best, F worst) into the
 * headline, human-legible drift signal the continuous-monitoring subscription
 * delivers: "grade regressed B -> D (down 2)". A worsened grade must read as a
 * REGRESSION so a subscriber's automation can page on it; a first baseline
 * (no prior grade) must degrade open to "unknown", never a false "regressed".
 * mcpGrade is the shared SSL-Labs-style band it rides on.
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { mcpGradeDelta, mcpGrade } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  pass++;
};

// --- mcpGrade band mapping (A best … F worst) ------------------------------
ok(mcpGrade(0, false) === "A", "risk 0 -> A");
ok(mcpGrade(9, false) === "A", "risk 9 -> A (upper A band)");
ok(mcpGrade(10, false) === "B", "risk 10 -> B");
ok(mcpGrade(29, false) === "B", "risk 29 -> B");
ok(mcpGrade(30, false) === "C", "risk 30 -> C");
ok(mcpGrade(49, false) === "C", "risk 49 -> C");
ok(mcpGrade(50, false) === "D", "risk 50 -> D");
ok(mcpGrade(69, false) === "D", "risk 69 -> D");
ok(mcpGrade(70, false) === "F", "risk 70 -> F");
ok(mcpGrade(100, false) === "F", "risk 100 -> F");
ok(mcpGrade(0, true) === "F", "any critical -> F regardless of score");
ok(mcpGrade(5, true) === "F", "low score + critical still F");

// --- regression (the paid alert's whole point) -----------------------------
let d = mcpGradeDelta("B", "D");
ok(d.direction === "worsened", "B->D worsened");
ok(d.letters === 2, "B->D is 2 letters");
ok(d.from === "B" && d.to === "D", "B->D carries from/to");

d = mcpGradeDelta("A", "F");
ok(d.direction === "worsened" && d.letters === 4, "A->F worsened by 4 (max)");

// --- improvement -----------------------------------------------------------
d = mcpGradeDelta("F", "A");
ok(d.direction === "improved" && d.letters === 4, "F->A improved by 4");
d = mcpGradeDelta("D", "C");
ok(d.direction === "improved" && d.letters === 1, "D->C improved by 1");

// --- same grade (a verdict/finding reshuffle that keeps the band) ----------
d = mcpGradeDelta("C", "C");
ok(d.direction === "same" && d.letters === 0, "C->C same, 0 letters");

// --- degrade-open: first baseline / malformed prior ------------------------
d = mcpGradeDelta(null, "B");
ok(d.direction === "unknown" && d.letters === 0, "null prior -> unknown (no false regression)");
d = mcpGradeDelta(undefined, "F");
ok(d.direction === "unknown" && d.letters === 0, "undefined prior -> unknown");
d = mcpGradeDelta("Z", "B");
ok(d.direction === "unknown" && d.letters === 0, "bogus prior grade -> unknown");
d = mcpGradeDelta("B", "Z");
ok(d.direction === "unknown", "bogus current grade -> unknown");
ok(mcpGradeDelta(null, "B").to === "B", "unknown still carries the current grade");

console.log(`ok - mcp grade-delta contract: ${pass} checks passed`);
