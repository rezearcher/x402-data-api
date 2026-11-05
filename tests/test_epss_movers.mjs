/**
 * Contract tests for the EPSS velocity feed
 * (src/index.ts: computeEpssMovers).
 *
 *   node tests/test_epss_movers.mjs
 *
 * computeEpssMovers is pure + deterministic over FIRST's EPSS rows (each row
 * carrying a ≤30d descending time-series, index 0 = yesterday). It must compute
 * correct 1d/7d deltas, flag rising / crossed-action-level / KEV-and-rising,
 * never throw on short or missing history, and rank top_movers by |Δ7d|.
 * cfw-hooks shims cloudflare:workers so the module imports under node.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { computeEpssMovers } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`ok - ${name}`); }

// Build a row: today's epss + a flat/declining series. `series` is an array of
// epss numbers for days −1, −2, … (descending, matching FIRST's shape).
function row(cve, today, series, percentile = 0.9) {
  return {
    cve,
    epss: String(today),
    percentile: String(percentile),
    date: "2026-11-05",
    "time-series": series.map((v, i) => ({
      epss: String(v),
      percentile: "0.5",
      date: `d-${i + 1}`,
    })),
  };
}

// A CVE that jumped from 0.10 (7d ago) to 0.60 today → Δ7d = 0.50, crosses 0.5.
const surging = row("CVE-2026-0001", 0.6, [0.55, 0.5, 0.4, 0.3, 0.2, 0.1, 0.1]);
// A flat high CVE: 0.80 steady → Δ7d ~ 0, not rising, not crossing.
const flatHigh = row("CVE-2026-0002", 0.8, [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]);
// A mild riser below the 0.1 threshold: +0.03 over 7d.
const mild = row("CVE-2026-0003", 0.2, [0.19, 0.19, 0.18, 0.18, 0.18, 0.17, 0.17]);
// A faller: 0.30 today, was 0.70 a week ago.
const faller = row("CVE-2026-0004", 0.3, [0.35, 0.4, 0.5, 0.6, 0.65, 0.7, 0.7]);

check("rising list picks only CVEs with Δ7d ≥ threshold", () => {
  const r = computeEpssMovers([surging, flatHigh, mild, faller], {});
  const rising = r.rising.map((m) => m.cve);
  assert.ok(rising.includes("CVE-2026-0001"), "surging must be rising");
  assert.ok(!rising.includes("CVE-2026-0002"), "flat must not be rising");
  assert.ok(!rising.includes("CVE-2026-0003"), "sub-threshold must not be rising");
});

check("7d delta is today − value 7 days ago", () => {
  const r = computeEpssMovers([surging], {});
  const m = r.top_movers[0];
  assert.strictEqual(m.cve, "CVE-2026-0001");
  assert.strictEqual(m.epss_7d_ago, 0.1);
  assert.strictEqual(m.delta_7d, 0.5);
  assert.strictEqual(m.epss_1d_ago, 0.55);
  assert.ok(Math.abs(m.delta_1d - 0.05) < 1e-9);
});

check("crossed_action_level = today ≥ level AND 7d-ago below it", () => {
  const r = computeEpssMovers([surging, flatHigh], {});
  const crossed = r.crossed_action_level.map((m) => m.cve);
  assert.deepStrictEqual(crossed, ["CVE-2026-0001"]);
  // flatHigh is ≥0.5 today but was ≥0.5 a week ago → did NOT just cross.
});

check("KEV + high EPSS surfaces in new_kev_high_epss and flags weaponized", () => {
  const r = computeEpssMovers([surging, flatHigh], { }, undefined);
  const r2 = computeEpssMovers([surging, flatHigh], { "CVE-2026-0001": true });
  assert.strictEqual(r.new_kev_high_epss.length, 0, "no KEV flags → empty");
  assert.deepStrictEqual(r2.new_kev_high_epss.map((m) => m.cve), ["CVE-2026-0001"]);
  const m = r2.rising.find((x) => x.cve === "CVE-2026-0001");
  assert.ok(m.flags.includes("in_kev"));
  assert.ok(m.flags.includes("weaponized_and_rising"));
});

check("faller gets a negative delta and a falling flag, not rising", () => {
  const r = computeEpssMovers([faller], {});
  const m = r.top_movers[0];
  assert.ok(m.delta_7d < 0);
  assert.ok(m.flags.includes("falling"));
  assert.ok(!m.flags.includes("rising"));
});

check("short / missing history never throws and yields null deltas", () => {
  const noHist = { cve: "CVE-2026-0009", epss: "0.4", percentile: "0.8", "time-series": [] };
  const oneDay = row("CVE-2026-0010", 0.4, [0.39]);
  const r = computeEpssMovers([noHist, oneDay], {});
  const a = r.top_movers.concat(r.rising, r.crossed_action_level);
  const m = r.universe_scanned; // just ensure it ran
  assert.strictEqual(m, 2);
  const nh = [...r.rising, ...r.crossed_action_level, ...r.new_kev_high_epss, ...r.top_movers]
    .concat(computeEpssMovers([noHist], {}).top_movers);
  // noHist has no series → 7d delta null, so it's excluded from top_movers.
  assert.ok(computeEpssMovers([noHist], {}).top_movers.length === 0);
  // oneDay has a 1d point but no 7d point → epss_7d_ago falls back to last point.
  const od = computeEpssMovers([oneDay], {}).top_movers[0];
  assert.ok(od.epss_1d_ago === 0.39);
});

check("top_movers ranks by absolute Δ7d, biggest first", () => {
  const r = computeEpssMovers([mild, surging, faller], {});
  assert.strictEqual(r.top_movers[0].cve, "CVE-2026-0001"); // |0.50| biggest
  // faller |0.40| should outrank mild |0.03|
  const order = r.top_movers.map((m) => m.cve);
  assert.ok(order.indexOf("CVE-2026-0004") < order.indexOf("CVE-2026-0003"));
});

check("custom thresholds flow through", () => {
  // Raise rising threshold above surging's 0.50 → nothing rises.
  const r = computeEpssMovers([surging], {}, { risingDelta7d: 0.6 });
  assert.strictEqual(r.rising.length, 0);
  assert.strictEqual(r.thresholds.rising_delta_7d, 0.6);
});

check("empty input yields a safe empty result", () => {
  const r = computeEpssMovers([], {});
  assert.strictEqual(r.universe_scanned, 0);
  assert.deepStrictEqual(r.rising, []);
  assert.ok(/No EPSS data/.test(r.summary));
});

console.log(`\n${pass} passed`);
