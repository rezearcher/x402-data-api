/**
 * Deterministic contract tests for the GoPlus-parity owner supply-concentration
 * verdict mapping (src/index.ts: ownerConcentrationRisk).
 *
 *   node tests/test_owner_concentration_risk.mjs
 *
 * The live read that PRODUCES owner_percent_bps (balanceOf(owner())/totalSupply)
 * is validated against clean tokens by the uptime_probe canary. This suite pins
 * the money-gate DECISION that measurement feeds: an EOA owner on a big slice of
 * supply raises dump risk; a CONTRACT owner (treasury/timelock/locker) is
 * reported but weighted lower; null percent contributes nothing (degrade-open);
 * and concentration ALONE never forces an AVOID floor (it is data-parity, not a
 * honeypot signal). It tests the shipped export, not a copy. Node >= 22.18 strips
 * types; the virtual cloudflare:workers module is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { ownerConcentrationRisk } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

// 1. null percent (renounced / no owner / non-standard balanceOf / no supply) →
//    inert, degrade-open. The churn-safety invariant: no signal, no touch.
check("null percent is inert (degrade-open)", () => {
  const r = ownerConcentrationRisk(null, "renounced");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.scoreAdd, 0);
});

// 2. Zero / dust holding → inert. A legitimate token whose owner holds ~nothing
//    must never be flagged.
check("0% owner holding contributes nothing", () => {
  assert.equal(ownerConcentrationRisk(0, "eoa").scoreAdd, 0);
  assert.deepEqual(ownerConcentrationRisk(0, "eoa").reasons, []);
});

// 3. Just under the 5% floor (499 bps) → fully inert (no noise on small holders).
check("sub-5% holding is inert", () => {
  const r = ownerConcentrationRisk(499, "eoa");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.scoreAdd, 0);
});

// 4. EOA owner at the 50%+ band → strongest dump-risk weight, with a reason.
check("EOA owner >=50% is weighted strongest", () => {
  const r = ownerConcentrationRisk(6000, "eoa"); // 60%
  assert.equal(r.scoreAdd, 20);
  assert.ok(/~60\.0% of total supply/.test(r.reasons[0]), `reason wrong: ${r.reasons[0]}`);
  assert.ok(/single sell could crash/.test(r.reasons[0]), `reason wrong: ${r.reasons[0]}`);
});

// 5. CONTRACT owner at the same 50%+ band → still reported, but weighted far
//    lower (treasury/timelock/locker is not a person who dumps).
check("contract owner >=50% is weighted lower than an EOA", () => {
  const r = ownerConcentrationRisk(6000, "contract");
  assert.equal(r.scoreAdd, 8);
  assert.ok(/owner is a contract/.test(r.reasons[0]), `reason wrong: ${r.reasons[0]}`);
});

// 6. EOA owner in the 20-50% band → elevated dump risk.
check("EOA owner 20-50% is elevated dump risk", () => {
  const r = ownerConcentrationRisk(3000, "eoa"); // 30%
  assert.equal(r.scoreAdd, 12);
  assert.ok(/elevated dump risk/.test(r.reasons[0]), `reason wrong: ${r.reasons[0]}`);
});

// 7. EOA owner in the 5-20% band → small additive flag only.
check("EOA owner 5-20% is a small additive flag", () => {
  const r = ownerConcentrationRisk(1000, "eoa"); // 10%
  assert.equal(r.scoreAdd, 5);
  assert.ok(/~10\.0% of total supply/.test(r.reasons[0]), `reason wrong: ${r.reasons[0]}`);
});

// 8. Boundary: exactly 5000 bps (50%) trips the top band (>=, not >).
check("exactly 5000 bps trips the top band", () => {
  assert.equal(ownerConcentrationRisk(5000, "eoa").scoreAdd, 20);
});

// 9. Boundary: exactly 500 bps (5%) trips the lowest band.
check("exactly 500 bps trips the lowest band", () => {
  assert.equal(ownerConcentrationRisk(500, "eoa").scoreAdd, 5);
});

// 10. Concentration NEVER returns a scoreFloor/AVOID — it is additive-only data
//     parity. (The shape has no scoreFloor key at all; assert that invariant.)
check("concentration is additive-only (no AVOID floor key)", () => {
  const r = ownerConcentrationRisk(9000, "eoa");
  assert.equal(r.scoreFloor, undefined);
  assert.ok(r.scoreAdd <= 20, "additive weight is bounded");
});

console.log(`\n${pass} passed`);
