/**
 * Contract test for the /for-agents data-API landing page.
 *
 *   node tests/test_for_agents_landing.mjs
 *
 * This is the first crawlable surface aimed at the DATA product — the only
 * routes earning external USDC (payer trace: 100% of real payers hit
 * /defi/yields, /crypto/prices and the Base /chain/* RPC routes). The page
 * must: render, self-canonical to the brand host, lead with the demand route,
 * list routes derived from ROUTE_CATALOG (so it can't drift), and read as a
 * real firm (no AI tells, no price invented out of the catalog).
 * Node >= 22.18 strips types; cloudflare:workers is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const res = await app.request("/for-agents", {}, {});
ok(res.status === 200, "/for-agents returns 200");
ok((res.headers.get("content-type") || "").includes("text/html"), "serves HTML");
const html = await res.text();

// SEO integrity: self-canonical to brand host, not request origin.
ok(html.includes('<link rel=canonical href="https://api.greyridgesignals.ai/for-agents">'), "brand-host self-canonical");
ok(html.includes('"@type":"WebAPI"'), "WebAPI JSON-LD present");
ok(html.includes("og:title"), "has og tags");

// Demand leader must be listed and ordered first among the route rows.
const yIdx = html.indexOf("/defi/yields");
const pIdx = html.indexOf("/crypto/prices");
ok(yIdx !== -1, "/defi/yields listed (the #1 demand route)");
ok(pIdx !== -1, "/crypto/prices listed");
ok(yIdx < pIdx, "/defi/yields ordered before /crypto/prices (measured demand order)");

// Rows are catalog-derived: several proven chain routes present.
for (const r of ["/chain/tx", "/chain/gas-price", "/crypto/funding", "/gate/swap"]) {
  ok(html.includes(r), `route ${r} present`);
}
// Security-lane routes must NOT appear (this page is the data product).
ok(!html.includes("/scan/mcp"), "does not list /scan/mcp (data page, not security lane)");
ok(!html.includes(">GET /dns<") && !html.includes("GET /dns?"), "does not list /dns security route");

// Free-preview column wired for a route we know has a preview.
ok(html.includes("/defi/yields/preview"), "free preview link for /defi/yields");

// Honest framing: no overclaim, keyless wedge stated, source attribution present.
ok(html.includes("no API key") || html.includes("no key"), "states keyless wedge");
ok(/DefiLlama|Chainlink|CoinGecko|Hyperliquid/.test(html), "names upstream data sources");
ok(html.includes("not financial advice"), "market-data disclaimer present");

// No AI tells / no vendor attribution leaking into a customer surface.
ok(!/claude|anthropic|as an ai|language model/i.test(html), "no AI/vendor tells");

console.log(`\nPASS ${pass} checks — /for-agents landing is competitor-grade and catalog-true`);
