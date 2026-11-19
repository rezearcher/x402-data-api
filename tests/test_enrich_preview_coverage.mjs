/**
 * Contract test: every BILLABLE enrichment route (/enrich/*) in ROUTE_CATALOG
 * must publish a free GET /<route>/preview in /openapi.json.
 *
 *   node tests/test_enrich_preview_coverage.mjs
 *
 * WHY: the judge's own demand analysis (x402-prepay-trust-screen outcomes) found
 * that repeat purchases on the x402 rail go to inference/search/ENRICHMENT inputs,
 * not stand-alone safety checks. The safety routes (/gate/swap, /chain/token-report)
 * shipped a polished free-preview conversion entrance; the work-input enrichment
 * routes did NOT — an evaluating agent could not see a sample before paying, so the
 * one category with live repeat demand had no conversion funnel. /enrich/domain had
 * no preview at all; /enrich/tech-risk had a handler but was undiscoverable (absent
 * from openapi). This guards the invariant so a future /enrich/* route can't ship
 * without its conversion entrance.
 *
 * The expected set is DERIVED from ROUTE_CATALOG (GET routes under /enrich/), never a
 * hardcoded path list, so it tracks the catalog as enrichment routes are added.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app, ROUTE_CATALOG } = await import("../src/index.ts");

const PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
const env = {
  PAY_TO, NETWORK: "eip155:8453", FACILITATOR_URL: "http://facilitator.test",
  USAGE_COUNTER: { idFromName: (x) => x, get: () => ({ async fetch() { return Response.json({}); } }) },
};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (["http://facilitator.test/supported", "https://facilitator.xpay.sh/supported"].includes(u))
    return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }], extensions: [], signers: {} });
  throw Error("unexpected upstream in enrich-preview test: " + u);
};

const oas = await (await app.request("/openapi.json", {}, env)).json();

// Derive the billable enrichment GET paths from the catalog (single source of truth).
const enrichPaths = ROUTE_CATALOG
  .filter((r) => r[1] === "GET" && typeof r[0] === "string" && r[0].startsWith("/enrich/"))
  .map((r) => r[0]);
assert.ok(enrichPaths.length >= 1, "ROUTE_CATALOG declares no /enrich/* GET routes — did the catalog shape change?");

let checked = 0;
for (const p of enrichPaths) {
  const previewPath = p + "/preview";
  const op = oas.paths?.[previewPath]?.get;
  assert.ok(op, `enrichment route ${p} is billable but its free conversion entrance ${previewPath} is MISSING from /openapi.json (work-input routes need a preview an agent can sample before paying)`);
  assert.ok(/free/i.test(JSON.stringify(op)), `${previewPath}: openapi op should describe it as a FREE sample`);
  // The paid route's own description should point an openapi-first reader at the preview.
  const paidDesc = JSON.stringify(oas.paths?.[p]?.get ?? {});
  assert.ok(paidDesc.toLowerCase().includes("preview"), `paid ${p} openapi description should advertise its free preview`);
  checked++;
}

console.log(`OK test_enrich_preview_coverage: ${checked} /enrich/* route(s) have a discoverable free preview advertised in openapi`);
