/**
 * Regression: pool liquidity is core to the /gate/swap verdict, so it owns a reserved
 * slice of the per-request subrequest budget and a full provider rotation, and a
 * liquidity lookup that FAILED is named with a cause - never read as a measured low
 * value, never scored as risk.
 *
 *   node tests/test_gate_liquidity_lane.mjs
 *
 * Production symptom (uptime probe 2026-11-06T04:10Z): canonical WETH returned
 * decision=hold verdict=CAUTION liquidity_usd=null, and known-good USDC returned
 * verdict=CAUTION. Cause: after the subrequest-budget commit the liquidity batches
 * shared the "core" attempt cap of 4, so when the first 4 providers in the rotation
 * were rate-limited the pool lookup returned null (4 of 8 providers is routine on
 * Workers egress), and null liquidity both HELD the gate and tripped the CAUTION
 * verdict through a "liquidity check unavailable" reason.
 */
import assert from "node:assert";
import { runOnce, loadFresh, PROVIDERS } from "./measure_gate_budget.mjs";
import { CAP } from "./gate_budget_world.mjs";

const MAX = CAP - 1;
let pass = 0;
async function check(name, fn) {
  await fn();
  pass++;
  console.log(`ok - ${name}`);
}
const idx = (u) => PROVIDERS.indexOf(u);
const underCap = (world, label) => {
  assert.ok(world.count() <= MAX, `${label}: ${world.count()} subrequests attempted (limit ${MAX}); ${JSON.stringify(world.byKind())}`);
  assert.ok(!world.entries().some((e) => e.mode === "cap"), `${label}: platform cap was hit`);
};

for (const tokenKey of ["weth", "usdc", "aero", "odd"]) {
  await check(`${tokenKey}: first 5 of 8 providers rate-limited still measures liquidity and goes`, async () => {
    const { world, body } = await runOnce({ tokenKey, providerMode: (u) => (idx(u) < 5 ? "429" : "ok"), cold: true });
    underCap(world, `${tokenKey} 5/8 down`);
    assert.notEqual(body.liquidity_usd, null, `liquidity lost: ${body.reason} | ${body.flags.join(" | ")}`);
    assert.equal(body.decision, "go", `${body.decision}: ${body.reason}`);
    assert.equal(body.liquidity_unavailable_cause, null);
  });
}

for (const tokenKey of ["weth", "usdc"]) {
  await check(`${tokenKey}: liquidity lookup down entirely holds, names the cause, and is not scored as risk`, async () => {
    const liqDown = (u, n, cls) => (cls.kind === "liquidity" ? "timeout" : "ok");
    const { world, body } = await runOnce({ tokenKey, providerMode: liqDown, cold: true });
    underCap(world, `${tokenKey} liquidity down`);
    assert.equal(body.decision, "hold");
    assert.equal(body.liquidity_usd, null);
    assert.equal(body.liquidity_unavailable_cause, "infra");
    assert.match(body.reason, /could not be measured/);
    assert.match(body.reason, /not a measured low value/);
    assert.ok(body.flags.some((f) => /pool liquidity not measured \(RPC providers failed/.test(f)), body.flags.join(" | "));
    // The static security score (30 for USDC in this world, once the deep-liquidity offset
    // is gone) may legitimately read CAUTION; unknown depth itself must add nothing.
    assert.ok(body.risk_score <= 30, `unknown depth was scored as risk: ${body.risk_score}`);
    assert.notEqual(body.verdict, "SAFE", "unmeasured depth must never read SAFE, or a failed lookup could clear a scam token");
    if (tokenKey === "weth") assert.equal(body.verdict, "CAUTION");
  });
}

await check("a read that failed after pools were found is a failed lookup, not 'no pool' (+10 risk)", async () => {
  let n = 0;
  const balanceReadDown = (u, i, cls) => (cls.kind === "liquidity" && ++n > 1 ? "timeout" : "ok");
  const { world, body } = await runOnce({ tokenKey: "aero", providerMode: balanceReadDown, cold: true });
  underCap(world, "balance read down");
  assert.equal(body.decision, "hold");
  assert.equal(body.liquidity_unavailable_cause, "infra");
  assert.ok(!body.flags.some((f) => /no Uniswap/.test(f)), body.flags.join(" | "));
});

await check("liquidity keeps its reserved slice until it settles (lane arithmetic)", async () => {
  const mod = await loadFresh();
  await mod.withSubrequestBudget(async () => {
    assert.equal(mod.budgetRemaining("liquidity"), 20 - 6, "liquidity may not spend the sim reserve");
    assert.equal(mod.budgetRemaining("sim"), 20 - 4, "sim may not spend the liquidity reserve");
    assert.equal(mod.budgetRemaining("core"), 20 - 6 - 4);
    assert.equal(mod.budgetRemaining("optional"), 20 - 6 - 4);
  }, mod.createSubrequestBudget(20, 6, 4));
});

await check("unproven stays fail-closed and a proven honeypot still blocks under the new lane", async () => {
  const storm = await runOnce({ tokenKey: "odd", providerMode: () => "timeout", cold: true });
  underCap(storm.world, "storm");
  assert.equal(storm.body.decision, "hold");
  const hp = await runOnce({ tokenKey: "aero", providerMode: () => "ok", cold: true, honeypot: true });
  underCap(hp.world, "honeypot");
  assert.equal(hp.body.decision, "block");
});

await check("storm of failures stays under the platform cap for every token", async () => {
  for (const tokenKey of ["weth", "usdc", "aero", "odd"]) {
    for (const mode of ["timeout", "429"]) {
      const { world } = await runOnce({ tokenKey, providerMode: () => mode, cold: true });
      underCap(world, `${tokenKey}/${mode}`);
    }
  }
});

console.log(`\n${pass} checks passed`);
