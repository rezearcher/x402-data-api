/**
 * Contract tests for trialQuota / refundTrial — the 3/IP/day full-depth trial
 * that converts the DATA routes (src/index.ts).
 *
 *   node tests/test_data_trial_quota.mjs
 *
 * Why this exists (evidence-driven): the revenue oracle shows 100% of external
 * payers hit the DATA routes (/defi/yields, /crypto/*), 0 on security — yet only
 * the SECURITY routes had a "try your real input free a few times" path. The
 * converting routes returned a 1-of-N teaser, so an evaluating agent could not
 * see the full output for ITS query before wiring a funded wallet. trialQuota
 * closes that gap. These assertions pin the contract that makes it safe:
 *   - exactly TRIAL_PER_DAY (3) full pulls per IP per day per route-scope;
 *   - scopes are independent (trying yields must not burn the prices budget);
 *   - a 4th pull is `exhausted` (handler then serves the teaser, never the data);
 *   - refundTrial gives a pull back (a typo'd poolId must not cost a real pull);
 *   - KV unbound => degrade OPEN (left:null, never a cap that breaks the teaser).
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { trialQuota, refundTrial } = await import("../src/index.ts");

// In-memory KV stub matching the slice of the Workers KV API the helpers use.
function makeKv() {
  const m = new Map();
  return {
    store: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); },
  };
}
// Minimal hono-context stub: env.API_KEYS + the cf-connecting-ip header.
const ctx = (kv, ip = "1.2.3.4") => ({
  env: { API_KEYS: kv },
  req: { header: (h) => (h === "cf-connecting-ip" ? ip : undefined) },
});

let pass = 0;
function check(name, cond) {
  assert.ok(cond, name);
  pass++;
  console.log(`ok - ${name}`);
}

// --- 3 pulls then exhausted -------------------------------------------------
{
  const kv = makeKv();
  const c = ctx(kv);
  const a = await trialQuota(c, "yields");
  const b = await trialQuota(c, "yields");
  const d = await trialQuota(c, "yields");
  const e = await trialQuota(c, "yields");
  check("1st pull left=2 not exhausted", a.left === 2 && a.exhausted === false);
  check("2nd pull left=1", b.left === 1 && b.exhausted === false);
  check("3rd pull left=0 not yet exhausted", d.left === 0 && d.exhausted === false);
  check("4th pull exhausted left=0", e.exhausted === true && e.left === 0);
}

// --- scopes are independent -------------------------------------------------
{
  const kv = makeKv();
  const c = ctx(kv);
  await trialQuota(c, "yields");
  await trialQuota(c, "yields");
  await trialQuota(c, "yields"); // yields now exhausted on next
  const yq = await trialQuota(c, "yields");
  const pricesFirst = await trialQuota(c, "prices");
  check("yields exhausted after 3", yq.exhausted === true);
  check("prices budget untouched by yields", pricesFirst.left === 2 && pricesFirst.exhausted === false);
}

// --- different IPs get separate budgets -------------------------------------
{
  const kv = makeKv();
  await trialQuota(ctx(kv, "9.9.9.9"), "funding");
  await trialQuota(ctx(kv, "9.9.9.9"), "funding");
  await trialQuota(ctx(kv, "9.9.9.9"), "funding");
  const otherIp = await trialQuota(ctx(kv, "8.8.8.8"), "funding");
  check("second IP has full budget", otherIp.left === 2);
}

// --- refundTrial gives a pull back ------------------------------------------
{
  const kv = makeKv();
  const c = ctx(kv);
  await trialQuota(c, "yieldverdict"); // left 2 (used=1)
  await refundTrial(c, "yieldverdict"); // used back to 0
  const again = await trialQuota(c, "yieldverdict");
  check("refund restored a pull (left=2 again)", again.left === 2);
  // refund never goes below zero
  await refundTrial(c, "yieldverdict");
  await refundTrial(c, "yieldverdict");
  await refundTrial(c, "yieldverdict");
  const key = `trialq:yieldverdict:1.2.3.4:${new Date().toISOString().slice(0, 10)}`;
  check("refund floors at 0 (no negative counter)", (parseInt(kv.store.get(key) ?? "0", 10) || 0) >= 0);
}

// --- KV unbound => degrade OPEN (no cap) ------------------------------------
{
  const c = { env: {}, req: { header: () => "1.2.3.4" } };
  const q = await trialQuota(c, "yields");
  check("no KV => left:null, never exhausted", q.left === null && q.exhausted === false);
  await refundTrial(c, "yields"); // must not throw
  check("refund with no KV is a no-op (no throw)", true);
}

// --- KV put() limit exceeded => degrade OPEN, never 500 the preview ---------
// A failing KV (daily put limit hit, or KV unreachable) used to throw straight
// out of trialQuota and surface as a top-level error on the verdict/preview —
// killing the warm-lead conversion path at the busiest moment. It must now serve
// the free trial uncounted (left:null) instead of throwing.
{
  const throwingKv = {
    async get() { throw new Error("KV get() failure"); },
    async put() { throw new Error("KV put() limit exceeded for the day."); },
  };
  const c = ctx(throwingKv);
  let threw = false, q = null;
  try { q = await trialQuota(c, "yieldverdict"); } catch { threw = true; }
  check("trialQuota does not throw when KV fails", threw === false);
  check("KV failure => degrade open (left:null, not exhausted)", q && q.left === null && q.exhausted === false);
  // put-only failure (get works, put over limit) must also degrade open
  const putOnlyKv = {
    async get() { return "0"; },
    async put() { throw new Error("KV put() limit exceeded for the day."); },
  };
  let threw2 = false, q2 = null;
  try { q2 = await trialQuota(ctx(putOnlyKv), "yields"); } catch { threw2 = true; }
  check("trialQuota degrades open on put-limit (get ok, put throws)", threw2 === false && q2.left === null);
  // refundTrial must also swallow a KV failure
  let threw3 = false;
  try { await refundTrial(c, "yieldverdict"); } catch { threw3 = true; }
  check("refundTrial swallows a KV failure (no throw)", threw3 === false);
}

console.log(`\n# test_data_trial_quota: ${pass} checks passed`);
