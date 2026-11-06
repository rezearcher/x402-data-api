/**
 * Regression: /gate/swap false-HOLD on a known-good token (usdc / weth) when the
 * honeypot transfer simulation is transiently unavailable.
 *
 *   node tests/test_gate_sim_retry.mjs
 *
 * Production symptom (uptime canary): usdc -> decision=hold verdict=SAFE
 * sellability_unverified=true, intermittently (same token alternated tested /
 * unavailable across consecutive calls). decideSwapGate is CORRECT to hold on an
 * unproven exit — that fail-closed branch is deliberate and must not be loosened.
 * The defect is upstream: one flaky RPC pass was final. These tests pin that
 *   1. a transiently-unavailable sim is re-run once (fresh provider rotation) and a
 *      successful re-run yields a verified (go-able) result,
 *   2. a PROVEN result (honeypot / transferable) is never re-run or overridden,
 *   3. a sim that is still unavailable after the re-run stays unverified -> HOLD,
 *   4. an unsafe token still BLOCKs, and an unverified one still HOLDs, end to end
 *      through the real decideSwapGate.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { retryUnavailableSim, decideSwapGate } = await import("../src/index.ts");

let pass = 0;
async function check(name, fn) {
  await fn();
  pass++;
  console.log(`ok - ${name}`);
}

const tested = (transferable) => ({ sim_status: "tested", transferable, note: "n" });
const unavailable = (cause) => ({ sim_status: "unavailable", transferable: null, unavailable_cause: cause, note: "n" });

const cleanSignals = (over = {}) => ({
  side: "buy", verdict: "SAFE", risk_score: 15, isHoneypot: false, sellability_unverified: false,
  reasons: [], liquidity_usd: 210_000_000, notional_usd: 100, ...over,
});

await check("transient infra failure is re-run once and the verified result wins", async () => {
  let calls = 0;
  const out = await retryUnavailableSim(unavailable("infra"), async () => { calls++; return tested(true); }, 0);
  assert.equal(calls, 1);
  assert.equal(out.sim_status, "tested");
  assert.equal(out.transferable, true);
});

await check("layout-classified unavailability is also re-run (a provider ignoring state overrides looks like a layout miss)", async () => {
  let calls = 0;
  const out = await retryUnavailableSim(unavailable("layout"), async () => { calls++; return tested(true); }, 0);
  assert.equal(calls, 1);
  assert.equal(out.sim_status, "tested");
});

await check("re-run happens at most once, then the unavailable result is kept", async () => {
  let calls = 0;
  const out = await retryUnavailableSim(unavailable("infra"), async () => { calls++; return unavailable("infra"); }, 0);
  assert.equal(calls, 1);
  assert.equal(out.sim_status, "unavailable");
});

await check("a thrown re-run degrades to the original unavailable result, never throws", async () => {
  const first = unavailable("infra");
  const out = await retryUnavailableSim(first, async () => { throw new Error("Too many subrequests"); }, 0);
  assert.equal(out, first);
});

await check("a proven honeypot is never re-run or overridden", async () => {
  let calls = 0;
  const first = tested(false);
  const out = await retryUnavailableSim(first, async () => { calls++; return tested(true); }, 0);
  assert.equal(calls, 0);
  assert.equal(out, first);
});

await check("a proven-transferable result is not re-run", async () => {
  let calls = 0;
  const out = await retryUnavailableSim(tested(true), async () => { calls++; return tested(false); }, 0);
  assert.equal(calls, 0);
  assert.equal(out.transferable, true);
});

await check("recovered sim -> known-good token is GO", () => {
  assert.equal(decideSwapGate(cleanSignals()).decision, "go");
});

await check("still-unverified sim -> HOLD (fail-closed preserved, no weakening)", () => {
  const d = decideSwapGate(cleanSignals({ sellability_unverified: true }));
  assert.equal(d.decision, "hold");
  assert.match(d.reason, /sellability unverified/);
});

await check("unsafe token (proven honeypot, AVOID) still BLOCKs on a buy", () => {
  const d = decideSwapGate(cleanSignals({ verdict: "AVOID", risk_score: 90, isHoneypot: true, reasons: ["honeypot: simulated transfer reverted, token cannot be sold/moved"] }));
  assert.equal(d.decision, "block");
});

await check("unsafe token that is ALSO sim-unverified still BLOCKs (AVOID outranks unverified)", () => {
  const d = decideSwapGate(cleanSignals({ verdict: "AVOID", risk_score: 100, isHoneypot: null, sellability_unverified: true, liquidity_usd: null, reasons: ["address is not a contract / not an ERC-20"] }));
  assert.equal(d.decision, "block");
});

console.log(`${pass} passed`);
