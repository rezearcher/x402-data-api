/**
 * Unit tests for the TIME-moat provenance archive (src/provenance.ts).
 *
 *   node tests/test_provenance.mjs
 *
 * Proves the pure archive logic is honest and bounded:
 *  - first-ever tick starts the series (tracked_since = now, ticks = 1, delta 0)
 *  - the throttle window suppresses writes (appended=false) inside it
 *  - a tick past the window appends and advances the trajectory
 *  - the tick cap bounds KV record size (oldest ticks drop off)
 *  - delta / delta_pct / direction are computed over first→last
 *  - a NaN/∞ upstream value never poisons the series
 *  - an empty/absent record summarizes to null (degrade-open)
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { appendTick, summarizeProvenance, mergeRecords, ARCH_TICK_CAP, ARCH_THROTTLE_MS } = await import(
  "../src/provenance.ts"
);

const HOUR = 3_600_000;
let pass = 0;
const fail = [];
function check(name, cond) {
  if (cond) pass++;
  else fail.push(name);
}

// --- first tick ------------------------------------------------------------
{
  const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);
  const { rec, appended } = appendTick(null, t0, 100);
  check("first tick appends", appended === true);
  check("first tick stored", rec.ticks.length === 1 && rec.ticks[0].v === 100);
  check("first_seen set", rec.first_seen === t0);

  const s = summarizeProvenance(rec, t0);
  check("summary tracked_since ISO", s.tracked_since === new Date(t0).toISOString());
  check("summary ticks=1", s.ticks === 1);
  check("summary delta 0 on single tick", s.value_delta === 0);
  check("summary direction flat on single tick", s.direction === "flat");
}

// --- throttle window suppresses writes -------------------------------------
{
  const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);
  let { rec } = appendTick(null, t0, 100);
  const r2 = appendTick(rec, t0 + ARCH_THROTTLE_MS - 1, 999); // inside window
  check("inside throttle → not appended", r2.appended === false);
  check("inside throttle → record unchanged", r2.rec.ticks.length === 1);
}

// --- tick past the window appends & advances -------------------------------
{
  const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);
  let cur = appendTick(null, t0, 100).rec;
  cur = appendTick(cur, t0 + 6 * HOUR, 110).rec; // 6h later
  cur = appendTick(cur, t0 + 12 * HOUR, 90).rec; // another 6h
  check("three ticks across windows", cur.ticks.length === 3);

  const s = summarizeProvenance(cur, t0 + 12 * HOUR);
  check("delta first→last = -10", s.value_delta === -10);
  check("delta_pct = -10%", s.value_delta_pct === -10);
  check("direction down", s.direction === "down");
  check("tracked_hours = 12", s.tracked_hours === 12);
  check("trajectory length = 3", s.trajectory.length === 3);
  check("first_value preserved", s.first_value === 100);
  check("last_value current", s.last_value === 90);
}

// --- cap bounds the record -------------------------------------------------
{
  const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);
  let cur = appendTick(null, t0, 0).rec;
  for (let i = 1; i <= ARCH_TICK_CAP + 20; i++) {
    cur = appendTick(cur, t0 + i * 6 * HOUR, i).rec;
  }
  check("cap enforced", cur.ticks.length === ARCH_TICK_CAP);
  // oldest ticks dropped → first value is no longer 0
  check("oldest dropped off front", cur.ticks[0].v > 0);
  check("newest retained", cur.ticks[cur.ticks.length - 1].v === ARCH_TICK_CAP + 20);
}

// --- junk value never poisons the series -----------------------------------
{
  const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);
  let cur = appendTick(null, t0, 100).rec;
  const bad = appendTick(cur, t0 + 6 * HOUR, NaN);
  check("NaN not appended", bad.appended === false && bad.rec.ticks.length === 1);
  const inf = appendTick(cur, t0 + 6 * HOUR, Infinity);
  check("Infinity not appended", inf.appended === false);
  // first-ever tick with junk → empty series, no fake tick
  const empty = appendTick(null, t0, NaN);
  check("first junk → empty series", empty.appended === false && empty.rec.ticks.length === 0);
}

// --- degrade-open: empty/absent summarizes to null -------------------------
{
  check("null record → null summary", summarizeProvenance(null, Date.now()) === null);
  check("empty ticks → null summary", summarizeProvenance({ first_seen: 1, ticks: [] }, Date.now()) === null);
}

// --- trajectory cap keeps payload small ------------------------------------
{
  const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);
  let cur = appendTick(null, t0, 1).rec;
  for (let i = 2; i <= 40; i++) cur = appendTick(cur, t0 + i * 6 * HOUR, i).rec;
  const s = summarizeProvenance(cur, t0 + 40 * 6 * HOUR, 12);
  check("trajectory capped to 12 in payload", s.trajectory.length === 12);
  check("full series still in record", cur.ticks.length === Math.min(40, ARCH_TICK_CAP));
}

// --- mergeRecords: baked + live union, dedup, earliest first_seen ----------
{
  const t0 = Date.UTC(2026, 9, 1, 0, 0, 0);
  const baked = { first_seen: t0, ticks: [{ t: t0, v: 10 }, { t: t0 + 6 * HOUR, v: 11 }] };
  const live = { first_seen: t0 + 6 * HOUR, ticks: [{ t: t0 + 6 * HOUR, v: 11 }, { t: t0 + 12 * HOUR, v: 12 }] };
  const m = mergeRecords(baked, live);
  check("merge dedups shared tick", m.ticks.length === 3);
  check("merge keeps earliest first_seen", m.first_seen === t0);
  check("merge sorted ascending", m.ticks[0].t < m.ticks[1].t && m.ticks[1].t < m.ticks[2].t);
  check("merge preserves newest value", m.ticks[m.ticks.length - 1].v === 12);

  check("merge(null,null) → null", mergeRecords(null, null) === null);
  check("merge(a,null) → a", mergeRecords(baked, null) === baked);
  check("merge(null,b) → b", mergeRecords(null, live) === live);

  // junk ticks are dropped from the union
  const dirty = { first_seen: t0, ticks: [{ t: t0, v: NaN }, { t: t0 + HOUR, v: 5 }] };
  const m2 = mergeRecords(dirty, null);
  check("merge keeps dirty record ref when b is null", m2 === dirty);
  const m3 = mergeRecords(dirty, { first_seen: t0 + 2 * HOUR, ticks: [{ t: t0 + 2 * HOUR, v: 6 }] });
  check("merge drops NaN tick in union", m3.ticks.every((p) => Number.isFinite(p.v)));
}

if (fail.length) {
  console.error(`FAIL (${fail.length}): ${fail.join(", ")}`);
  process.exit(1);
}
console.log(`PASS — ${pass} provenance checks`);
