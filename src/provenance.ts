// provenance.ts — the TIME moat.
//
// Every competitor in our two earning lanes (x402-seller, Usenami, fernsugi's
// clone, Rug Munch, PulseNetwork, Yield.xyz) returns a POINT-IN-TIME value: the
// price/yield/funding right now. None of them can tell a buyer-agent "this is
// the 41st tick we've recorded for BTC, first seen 2026-10-02, and it is +3.1%
// since we started tracking" — because they never stored the history and cannot
// reconstruct it after the fact. We can: a compact per-series tick archive in
// Workers KV, written on serve and bounded in size, turns every paid DATA call
// into a provenance-bearing answer whose value COMPOUNDS with age.
//
// This module is PURE (no KV, no fetch, no Date.now side-effects passed in by
// the caller) so it is unit-testable and the KV wrapper in index.ts stays a thin
// degrade-open shell. The caller supplies `now` and the current value; we own
// the append/throttle/cap/summarize logic.

export type ProvTick = { t: number; v: number };

export type ProvRecord = {
  first_seen: number; // ms epoch of the first tick we ever recorded
  ticks: ProvTick[]; // oldest-first, capped
};

// Bounded downside: a record never grows past this many ticks (KV value stays
// small — ~48 * ~25 bytes ≈ 1.2 KB, well under the 25 MB KV value limit) and we
// write at most one tick per throttle window, so a hot series costs a predictable
// handful of KV puts per day, not one per request.
export const ARCH_TICK_CAP = 48;
export const ARCH_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h → ≤4 writes/series/day

// Append a tick, honouring the throttle window. Returns the (possibly unchanged)
// record and whether a write is actually needed — the KV wrapper only calls
// put() when `appended` is true, so throttled reads cost zero writes.
export function appendTick(
  rec: ProvRecord | null | undefined,
  now: number,
  value: number,
  throttleMs: number = ARCH_THROTTLE_MS,
  cap: number = ARCH_TICK_CAP,
): { rec: ProvRecord; appended: boolean } {
  if (!Number.isFinite(value)) {
    // Never archive a junk value — a null/NaN upstream reading must not poison
    // the series. If we have no record yet, start an empty one without a tick.
    if (!rec) return { rec: { first_seen: now, ticks: [] }, appended: false };
    return { rec, appended: false };
  }
  if (!rec || !Array.isArray(rec.ticks) || rec.ticks.length === 0) {
    return { rec: { first_seen: rec?.first_seen ?? now, ticks: [{ t: now, v: value }] }, appended: true };
  }
  const last = rec.ticks[rec.ticks.length - 1];
  if (now - last.t < throttleMs) {
    // Inside the throttle window — keep the series as-is (no write).
    return { rec, appended: false };
  }
  const ticks = [...rec.ticks, { t: now, v: value }];
  const trimmed = ticks.length > cap ? ticks.slice(ticks.length - cap) : ticks;
  return { rec: { first_seen: rec.first_seen, ticks: trimmed }, appended: true };
}

// Merge two records of the SAME series+id into one honest history: union the
// ticks (dedup by timestamp, oldest-first), keep the earliest first_seen, cap to
// `cap`. Used to combine the git-committed archive (reliable, cron-written) with
// a best-effort live KV record (fresher intraday ticks when writes succeed), so
// the provenance block delivers maximum real history from whichever source has
// it — and never double-counts a shared tick.
export function mergeRecords(
  a: ProvRecord | null | undefined,
  b: ProvRecord | null | undefined,
  cap: number = ARCH_TICK_CAP,
): ProvRecord | null {
  const ar = a && Array.isArray(a.ticks) ? a : null;
  const br = b && Array.isArray(b.ticks) ? b : null;
  if (!ar && !br) return null;
  if (!ar) return br;
  if (!br) return ar;
  const byT = new Map<number, number>();
  for (const t of ar.ticks) if (Number.isFinite(t.t) && Number.isFinite(t.v)) byT.set(t.t, t.v);
  for (const t of br.ticks) if (Number.isFinite(t.t) && Number.isFinite(t.v)) byT.set(t.t, t.v);
  const ticks = [...byT.entries()].map(([t, v]) => ({ t, v })).sort((x, y) => x.t - y.t);
  const trimmed = ticks.length > cap ? ticks.slice(ticks.length - cap) : ticks;
  const firstSeen = Math.min(
    ar.first_seen ?? Number.POSITIVE_INFINITY,
    br.first_seen ?? Number.POSITIVE_INFINITY,
    trimmed.length ? trimmed[0].t : Number.POSITIVE_INFINITY,
  );
  return { first_seen: Number.isFinite(firstSeen) ? firstSeen : (trimmed[0]?.t ?? Date.now()), ticks: trimmed };
}

export type ProvSummary = {
  tracked_since: string; // ISO of first_seen
  tracked_hours: number; // age of the series in hours (1dp)
  ticks: number; // how many samples we hold
  first_value: number | null;
  last_value: number | null;
  value_delta: number | null; // last - first (absolute)
  value_delta_pct: number | null; // % change since first tick (1 dp when finite)
  direction: "up" | "down" | "flat" | "unknown";
  trajectory: ProvTick[]; // compact ISO-less tick list (ms epochs), capped for payload size
};

// Summarize a record into the provenance block attached to each DATA item. Pure:
// `now` is supplied so `tracked_hours` is testable. `maxPoints` caps the
// trajectory echoed into the payload (the full series stays in KV).
export function summarizeProvenance(
  rec: ProvRecord | null | undefined,
  now: number,
  maxPoints: number = 12,
): ProvSummary | null {
  if (!rec || !Array.isArray(rec.ticks) || rec.ticks.length === 0) return null;
  const ticks = rec.ticks;
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  const firstV = Number.isFinite(first.v) ? first.v : null;
  const lastV = Number.isFinite(last.v) ? last.v : null;
  let delta: number | null = null;
  let deltaPct: number | null = null;
  let direction: ProvSummary["direction"] = "unknown";
  if (firstV !== null && lastV !== null) {
    delta = round(lastV - firstV, 8);
    if (firstV !== 0) deltaPct = round(((lastV - firstV) / Math.abs(firstV)) * 100, 1);
    direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  }
  const traj = ticks.length > maxPoints ? ticks.slice(ticks.length - maxPoints) : ticks;
  return {
    tracked_since: new Date(rec.first_seen).toISOString(),
    tracked_hours: round((now - rec.first_seen) / 3_600_000, 1),
    ticks: ticks.length,
    first_value: firstV,
    last_value: lastV,
    value_delta: delta,
    value_delta_pct: deltaPct,
    direction,
    trajectory: traj.map((p) => ({ t: p.t, v: p.v })),
  };
}

function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return n;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
