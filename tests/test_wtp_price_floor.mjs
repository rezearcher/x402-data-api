/**
 * Contract tests for the willingness-to-pay price floor
 * (src/index.ts: applyWtpPriceFloor + the live ROUTE_CATALOG it produces).
 *
 *   node tests/test_wtp_price_floor.mjs
 *
 * The floor lifts the COLD long-tail (zero proven external demand, priced
 * strictly between the magnet ceiling and the floor) to a 4000-micro floor that
 * sits BELOW the observed $0.005 inelastic tolerance, WITHOUT ever raising a
 * route a real buyer already pays (barbell: bounded downside) or a magnet price.
 * Protection is DERIVED from the live DEMAND_SNAPSHOT — no hardcoded route list.
 * renderable off the shipped exports; cfw-hooks shims cloudflare:workers.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { applyWtpPriceFloor, ROUTE_CATALOG, ROUTE_CATALOG_BASE } = await import("../src/index.ts");
const { DEMAND_SNAPSHOT } = await import("../src/demand_snapshot.ts");

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`ok - ${name}`); }

const FLOOR = 4000;
const row = (p, micros) => [p, "GET", (micros / 1e6).toFixed(3), String(micros), "desc", ["data"]];

// 1. A cold (zero-demand) route priced between the magnet ceiling and the floor
//    is raised to exactly the floor, with usd and micros set together.
check("cold long-tail route is raised to the floor (usd + micros together)", () => {
  const out = applyWtpPriceFloor([row("/cold-2000", 2000), row("/cold-3000", 3000)], { "/other": 1 });
  assert.strictEqual(out[0][3], "4000", "2000 -> 4000 micros");
  assert.strictEqual(out[0][2], "0.004", "2000 -> 0.004 usd");
  assert.strictEqual(out[1][3], "4000", "3000 -> 4000 micros");
  assert.strictEqual(out[1][2], "0.004", "3000 -> 0.004 usd");
});

// 2. A route with >=1 proven external payer is NEVER raised (bounded downside).
check("proven-payer route is never raised", () => {
  const out = applyWtpPriceFloor([row("/paid", 2000)], { "/paid": 1 });
  assert.strictEqual(out[0][3], "2000", "paid route stays at its price");
});

// 3. A magnet price (<=1000) is never raised.
check("magnet price (<=1000) is never raised", () => {
  const out = applyWtpPriceFloor([row("/magnet", 1000), row("/magnet2", 500)], { "/x": 1 });
  assert.strictEqual(out[0][3], "1000");
  assert.strictEqual(out[1][3], "500");
});

// 4. A route already at/above the floor is untouched.
check("route already >= floor is untouched", () => {
  const out = applyWtpPriceFloor([row("/hi", 5000), row("/atfloor", 4000)], { "/x": 1 });
  assert.strictEqual(out[0][3], "5000");
  assert.strictEqual(out[1][3], "4000");
});

// 5. Degrade-open: with no usable snapshot, nothing is raised (we can't tell a
//    paid route from a cold one, so the safe direction is to touch nothing).
check("empty/absent snapshot raises nothing (degrade-open)", () => {
  const base = [row("/a", 2000), row("/b", 3000)];
  // {} and null are "no usable snapshot" -> raise nothing. (undefined is NOT tested
  // here: it triggers the default param = the real live snapshot, by design.)
  for (const snap of [{}, null]) {
    const out = applyWtpPriceFloor(base, snap);
    assert.strictEqual(out[0][3], "2000", "no raise without snapshot");
    assert.strictEqual(out[1][3], "3000", "no raise without snapshot");
  }
});

// 6. LIVE invariant — the shipped ROUTE_CATALOG vs its base:
//    (a) every row's usd == micros/1e6 (advertised == charged);
//    (b) no route with >=1 external payer (and >magnet, <floor) was raised;
//    (c) every raised route had a base price in (magnet, floor) and 0 payers;
//    (d) magnet + >=floor routes are identical to base;
//    (e) at least one route is actually raised (the change is real).
check("live ROUTE_CATALOG honors every floor invariant vs base", () => {
  const paid = DEMAND_SNAPSHOT.external_by_route || {};
  assert.strictEqual(ROUTE_CATALOG.length, ROUTE_CATALOG_BASE.length, "same length (permutation)");
  const baseByPath = new Map(ROUTE_CATALOG_BASE.map((r) => [r[0], r]));
  let raised = 0;
  for (const r of ROUTE_CATALOG) {
    const [p, , usd, micros] = r;
    // (a) usd/micros consistency
    assert.strictEqual(Math.round(Number(usd) * 1e6), Number(micros), `${p} usd==micros`);
    const base = baseByPath.get(p);
    assert.ok(base, `${p} exists in base`);
    const bm = Number(base[3]);
    const cm = Number(micros);
    if (cm !== bm) {
      raised++;
      // (c) only a cold long-tail route may move, and only up to the floor
      assert.strictEqual(cm, FLOOR, `${p} raised only to floor`);
      assert.ok(bm > 1000 && bm < FLOOR, `${p} base ${bm} was in (magnet, floor)`);
      assert.strictEqual(Number(paid[p]) || 0, 0, `${p} raised had 0 external payers`);
    } else {
      // (b)+(d) unchanged rows: a paid/ magnet/ >=floor route must be here
      const protectedReason = (Number(paid[p]) || 0) >= 1 || bm <= 1000 || bm >= FLOOR;
      assert.ok(protectedReason, `${p} unchanged only if paid/magnet/>=floor`);
    }
  }
  assert.ok(raised >= 1, "at least one cold route was actually raised");
  console.log(`   (${raised} cold long-tail routes lifted to ${FLOOR} micros; paid/magnet routes protected)`);
});

console.log(`\n${pass} checks passed`);
