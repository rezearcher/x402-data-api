/**
 * Regression: /gate/swap must stay inside Cloudflare's free-plan 50-subrequests-per-
 * request cap, including with failing/slow RPC providers and a cold slot cache, while
 * remaining fail-closed.
 *
 *   node tests/test_gate_subrequest_budget.mjs
 *
 * Production symptom: /gate/swap/preview?token=usdc returned `hold SAFE` on 5 of 6 calls
 * with "transfer simulation unavailable (RPC providers failed or rate-limited...)". The
 * path spent 28-41 fetches on a healthy network and every failed provider added more
 * (old rotation: 8 per call, 11 with the retry pass), so one flaky provider pushed the
 * late, sequential transfer simulation past the cap.
 *
 * The harness counts EVERY fetch (RPC, facilitator init, sourcify, goplus, price) plus
 * KV and Cache API operations as subrequests - conservative on purpose - and throws on
 * the 51st like workerd. The assertions are on fetches ATTEMPTED (<= 49), not just on
 * ones that happened to succeed, so a loop that merely fails quietly still fails the test.
 */
import assert from "node:assert";
import { runOnce, loadFresh, PROVIDERS } from "./measure_gate_budget.mjs";
import { fakeCacheApi, CAP, createWorld, TOKENS } from "./gate_budget_world.mjs";

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

const scenarios = {
  healthy: () => "ok",
  "half the providers 429": (u) => (idx(u) % 2 === 0 ? "429" : "ok"),
  "first 3 providers time out (slow)": (u) => (idx(u) < 3 ? "timeout" : "ok"),
  "only one provider healthy": (u) => (idx(u) === 4 ? "ok" : "timeout"),
  "every provider times out (storm)": () => "timeout",
};

for (const tokenKey of ["usdc", "aero", "odd"]) {
  for (const [name, providerMode] of Object.entries(scenarios)) {
    await check(`${tokenKey} / ${name}: cold isolate + cold slot cache stays under ${CAP}`, async () => {
      const { world, body } = await runOnce({ tokenKey, providerMode, cold: true, cacheApi: fakeCacheApi() });
      underCap(world, `${tokenKey}/${name}`);
      if (name === "healthy") {
        assert.equal(body.decision, "go");
        assert.equal(body.sellability_unverified, false);
      }
      if (name.startsWith("every provider")) {
        assert.notEqual(body.decision, "go", "storm must never read as go");
      }
    });
  }
}

await check("a failing sim never reads as go and names a cause (fail-closed, honest cause)", async () => {
  const simDown = (u, n, cls) => (cls.kind.startsWith("sim") || cls.kind === "tax" ? "timeout" : "ok");
  const { world, body } = await runOnce({ tokenKey: "usdc", providerMode: simDown, cold: true });
  underCap(world, "sim down");
  assert.equal(body.decision, "hold");
  assert.equal(body.sellability_unverified, true);
  assert.ok(["infra", "budget"].includes(body.sellability_unverified_cause), `cause=${body.sellability_unverified_cause}`);
});

await check("budget exhaustion is reported as its own cause, still holds", async () => {
  const mod = await loadFresh();
  const budget = mod.createSubrequestBudget(9, 3);
  const { body, world } = await runOnce({ tokenKey: "odd", providerMode: () => "ok", mod, budget, cacheApi: fakeCacheApi() });
  underCap(world, "tiny budget");
  assert.equal(body.decision, "hold");
  assert.equal(body.sellability_unverified, true);
  assert.equal(body.sellability_unverified_cause, "budget");
  assert.ok(body.flags.some((f) => /subrequest budget/.test(f)), body.flags.join(" | "));
});

await check("the simulation's reserved slice survives every other lookup failing slowly", async () => {
  const lowValueDown = (u, n, cls) => (["proxy", "owner", "meta", "name", "supply", "sourcify", "goplus", "price"].includes(cls.kind) ? "timeout" : "ok");
  const { world, body } = await runOnce({ tokenKey: "weth", providerMode: lowValueDown, cold: true });
  underCap(world, "lowValueDown");
  assert.equal(body.sellability_unverified, false, "sim must still be verified when only low-value lookups fail");
});

await check("cold slot cache then warm cache: the second request skips discovery (cross-isolate via Cache API)", async () => {
  const cacheApi = fakeCacheApi();
  const first = await runOnce({ tokenKey: "odd", providerMode: () => "ok", cold: true, cacheApi });
  underCap(first.world, "cold cache");
  const coldDiscovery = first.world.byKind()["sim-discovery"];
  assert.ok(coldDiscovery >= 3, `cold discovery should have to search (got ${coldDiscovery})`);
  assert.ok([...cacheApi.store.keys()].some((k) => k.includes("/v1/balance-slot/")), "slot was not written to the Cache API");

  const second = await runOnce({ tokenKey: "odd", providerMode: () => "ok", cold: true, cacheApi });
  underCap(second.world, "warm cache");
  assert.equal(second.body.decision, "go");
  assert.equal(second.world.byKind()["sim-discovery"], 1, "warm cache should cost exactly one verify call");
  assert.ok(second.world.count() < first.world.count(), "warm path must be cheaper");
});

await check("a stale cached slot is verified, rejected, and rediscovered (never trusted blindly)", async () => {
  const cacheApi = fakeCacheApi();
  cacheApi.store.set(
    `https://gate-cache.internal/v1/balance-slot/${TOKENS.odd.addr}`,
    new Response(JSON.stringify({ slot: "5" }), { headers: { "content-type": "application/json" } }),
  );
  const { world, body } = await runOnce({ tokenKey: "odd", providerMode: () => "ok", cold: true, cacheApi });
  underCap(world, "stale cache");
  assert.equal(body.decision, "go");
  assert.equal(body.sellability_unverified, false);
});

await check("an infra failure mid-bisect is NOT read as a honeypot (tri-state discovery)", async () => {
  let discoveries = 0;
  const flakyBisect = (u, n, cls) => {
    if (cls.kind !== "sim-discovery") return "ok";
    discoveries++;
    return discoveries >= 3 ? "timeout" : "ok";
  };
  const { body, world } = await runOnce({ tokenKey: "odd", providerMode: flakyBisect, cold: true });
  underCap(world, "flaky bisect");
  assert.notEqual(body.decision, "block", "an unproven sim must hold, never block on a guessed slot");
  assert.equal(body.decision, "hold");
  assert.equal(body.sellability_unverified, true);
});

await check("a proven honeypot still blocks", async () => {
  const { body, world } = await runOnce({ tokenKey: "aero", providerMode: () => "ok", cold: true, honeypot: true });
  underCap(world, "honeypot");
  assert.equal(body.decision, "block");
});

await check("per-call attempts are capped: sim-lane fetches never exceed the sim reserve in a storm", async () => {
  const { world } = await runOnce({ tokenKey: "usdc", providerMode: () => "timeout", cold: true });
  const simFetches = (world.byKind()["sim-discovery"] ?? 0) + (world.byKind()["sim-probe"] ?? 0);
  assert.ok(simFetches <= 14, `sim lane spent ${simFetches}`);
  for (const [url, v] of Object.entries(world.simAttempts())) {
    assert.ok(v.discovery + v.probe <= 4, `${url} was hit ${v.discovery + v.probe} times by the sim`);
  }
});

await check("lane arithmetic: low-value lanes cannot spend the sim's reserve until it settles", async () => {
  const mod = await loadFresh();
  await mod.withSubrequestBudget(async () => {
    assert.equal(mod.budgetRemaining("core"), 10 - 4);
    assert.equal(mod.budgetRemaining("sim"), 10);
    assert.equal(mod.budgetRemaining("optional"), 6);
  }, mod.createSubrequestBudget(10, 4));
  assert.equal(mod.budgetRemaining("core"), Infinity, "outside a budget scope metering is a no-op");
});

console.log(`\n${pass} checks passed`);
