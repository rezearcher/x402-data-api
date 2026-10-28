/**
 * Contract test for demand-ordered discovery manifest.
 *
 *   node tests/test_manifest_demand_order.mjs
 *
 * GROUND TRUTH (scripts/external_payer_routes.py, 30d): 100% of external USDC
 * lands on DATA routes; /crypto/prices + /defi/yields tie at 5 distinct external
 * payers each, while /gate/swap, /chain/token-report, /chain/token-security,
 * /pm/markets and /crypto/funding have ZERO external payers EVER. Yet the raw
 * ROUTE_CATALOG declaration order leads /.well-known/x402 resources[] (the list
 * the Agent402 router + CDP Bazaar ingest top-down) with exactly those five
 * zero-revenue routes and buries the two proven earners. demandOrderedCatalog
 * fixes that by sorting a copy of the catalog by the sensor-regenerated
 * DEMAND_SNAPSHOT (external payers only, self excluded) — never a hand-ordered
 * priority array (the no-hardcoded-list anti-pattern), and degrade-open to the
 * raw catalog order if the snapshot is missing/empty. This test locks the
 * contract against the real exports. cloudflare:workers is shimmed by
 * cfw-hooks.mjs. Node >= 22.18 strips the TS types on import.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { demandOrderedCatalog, ROUTE_CATALOG } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

const paths = (rows) => rows.map((r) => r[0]);
const idx = (rows, p) => paths(rows).indexOf(p);

// (1) Demand snapshot leads the manifest with the proven earners, not the
//     zero-external-revenue safety routes that currently open the catalog.
{
  const snap = { "/defi/yields": 5, "/crypto/prices": 5, "/chain/gas-price": 2 };
  const ordered = demandOrderedCatalog(ROUTE_CATALOG, snap);
  ok(idx(ordered, "/defi/yields") < idx(ordered, "/gate/swap"), "yields before gate/swap");
  ok(idx(ordered, "/crypto/prices") < idx(ordered, "/gate/swap"), "prices before gate/swap");
  ok(idx(ordered, "/defi/yields") < idx(ordered, "/chain/token-report"), "yields before token-report");
  ok(idx(ordered, "/crypto/prices") < idx(ordered, "/chain/token-report"), "prices before token-report");
  ok(idx(ordered, "/chain/gas-price") < idx(ordered, "/gate/swap"), "gas-price (2 payers) before gate/swap (0)");
  // The top two are exactly the demand leaders (tie broken by catalog index).
  const top2 = new Set(paths(ordered).slice(0, 2));
  ok(top2.has("/defi/yields") && top2.has("/crypto/prices"), "top two are the two 5-payer routes");
}

// (2) Degrade-open: a missing / empty / garbage snapshot yields the untouched
//     catalog order — never a drop, never a reshuffle.
{
  const raw = paths(ROUTE_CATALOG);
  eq(JSON.stringify(paths(demandOrderedCatalog(ROUTE_CATALOG, {}))), JSON.stringify(raw), "empty snapshot === raw order");
  // all-zero demand -> stable raw order
  const zeros = Object.fromEntries(raw.map((p) => [p, 0]));
  eq(JSON.stringify(paths(demandOrderedCatalog(ROUTE_CATALOG, zeros))), JSON.stringify(raw), "all-zero snapshot === raw order");
}

// (3) The sorted set is always a same-length permutation of the catalog: no
//     route added, dropped or duplicated for ANY snapshot.
{
  const snap = { "/defi/yields": 5, "/crypto/prices": 5, "/chain/gas-price": 2, "/does/not/exist": 99 };
  const ordered = demandOrderedCatalog(ROUTE_CATALOG, snap);
  eq(ordered.length, ROUTE_CATALOG.length, "length preserved");
  eq(new Set(paths(ordered)).size, ROUTE_CATALOG.length, "no duplicates");
  const rawSet = new Set(paths(ROUTE_CATALOG));
  ok(paths(ordered).every((p) => rawSet.has(p)), "every output route exists in the catalog");
  ok(paths(ROUTE_CATALOG).every((p) => paths(ordered).includes(p)), "every catalog route present in output");
  // A route not in the catalog but present in the snapshot must NOT be injected.
  ok(!paths(ordered).includes("/does/not/exist"), "snapshot-only phantom route is not injected");
}

// (4) Stability — equal-demand routes keep their relative catalog order, so the
//     ordering is deterministic across deploys (diff-friendly, no churn).
{
  const snap = { "/defi/yields": 5, "/crypto/prices": 5 };
  const a = paths(demandOrderedCatalog(ROUTE_CATALOG, snap));
  const b = paths(demandOrderedCatalog(ROUTE_CATALOG, snap));
  eq(JSON.stringify(a), JSON.stringify(b), "deterministic across calls");
  // /defi/yields precedes /crypto/prices only if it precedes it in the catalog;
  // whichever it is, the order is the catalog order among the tied pair.
  const ci = paths(ROUTE_CATALOG);
  const expectFirst = ci.indexOf("/defi/yields") < ci.indexOf("/crypto/prices") ? "/defi/yields" : "/crypto/prices";
  eq(a[0], expectFirst, "tie broken by original catalog index");
}

// (5) The live (default) snapshot is wired: calling with no override still
//     reorders (proves the import is bound, not an empty object).
{
  const live = paths(demandOrderedCatalog());
  eq(live.length, ROUTE_CATALOG.length, "live-snapshot call preserves length");
  ok(["/crypto/prices", "/defi/yields"].includes(live[0]), "live manifest leads with a proven earner");
}

console.log(`manifest-demand-order contract: ${pass} checks passed`);
