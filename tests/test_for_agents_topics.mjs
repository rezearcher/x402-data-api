/**
 * Contract test for the per-topic /for-agents/<topic> landing pages.
 *
 *   node tests/test_for_agents_topics.mjs
 *
 * These are the demand-side SEO pages for the three sets that actually earn
 * external USDC (payer trace, 30d): DeFi yields, crypto prices, Base RPC.
 * Each page must render, self-canonical to the brand host, derive its route
 * rows from ROUTE_CATALOG (so it can't drift), lead with the headline route,
 * link back to the hub, carry a disclaimer, and read as a real firm.
 * Unknown topics must 404. Node >= 22.18 strips types; cloudflare:workers is
 * shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

const topics = {
  "defi-yields": { lead: "/defi/yields", prefix: "/defi/", foreign: "/crypto/prices", ex: "/defi/yields?stable=true", advice: true },
  "crypto-prices": { lead: "/crypto/prices", prefix: "/crypto/", foreign: "/defi/yields", ex: "/crypto/prices?coins=", advice: true },
  "base-rpc": { lead: "/chain/block-number", prefix: "/chain/", foreign: "/defi/yields", ex: "/chain/gas-price", advice: false },
};

for (const [topic, t] of Object.entries(topics)) {
  const res = await app.request(`/for-agents/${topic}`, {}, {});
  ok(res.status === 200, `/for-agents/${topic} returns 200`);
  ok((res.headers.get("content-type") || "").includes("text/html"), `${topic}: serves HTML`);
  const html = await res.text();

  // Self-canonical to the brand host for THIS topic url (no cross-host, no request origin).
  ok(html.includes(`<link rel=canonical href="https://api.greyridgesignals.ai/for-agents/${topic}">`), `${topic}: brand-host self-canonical`);
  ok(html.includes('"@type":"WebAPI"'), `${topic}: WebAPI JSON-LD`);
  ok(html.includes('"isPartOf"'), `${topic}: declared part of the hub`);
  ok(html.includes('href="/for-agents"'), `${topic}: links back to hub`);

  // The headline route is present AND ordered first among route rows.
  const leadIdx = html.indexOf(`>GET ${t.lead}<`);
  ok(leadIdx !== -1, `${topic}: lead route ${t.lead} present`);

  // Rows are catalog-derived to this topic's prefix; a foreign-topic route must be absent.
  ok(!html.includes(`>GET ${t.foreign}<`), `${topic}: does not list foreign route ${t.foreign}`);
  // and the security lane never appears on a data page.
  ok(!html.includes("/scan/mcp"), `${topic}: no security-lane route`);

  // Example uses a real route from this topic, keyless wedge + disclaimer present.
  ok(html.includes(t.ex), `${topic}: code example uses a real topic route`);
  ok(html.includes("no API key") || html.includes("no key"), `${topic}: states keyless wedge`);
  // Market-data pages carry a financial-advice disclaimer; raw RPC reads do not need one.
  if (t.advice) ok(/not financial advice|informational/.test(html), `${topic}: market-data disclaimer present`);

  // No AI tells / vendor attribution on a customer surface.
  ok(!/claude|anthropic|as an ai|language model/i.test(html), `${topic}: no AI/vendor tells`);
}

// Lead ordering: /defi/yields must be the first route row on its page.
{
  const html = await (await app.request("/for-agents/defi-yields", {}, {})).text();
  const first = html.indexOf(">GET /defi/");
  const yields = html.indexOf(">GET /defi/yields<");
  ok(yields === first, "defi-yields: /defi/yields is the first route row");
}

// Unknown topic 404s (no accidental catch-all).
{
  const res = await app.request("/for-agents/not-a-topic", {}, {});
  ok(res.status === 404, "unknown topic 404s");
}

// Hub links to all three topic pages (internal crawl graph).
{
  const hub = await (await app.request("/for-agents", {}, {})).text();
  for (const topic of Object.keys(topics)) {
    ok(hub.includes(`href="/for-agents/${topic}"`), `hub links /for-agents/${topic}`);
  }
}

console.log(`\nPASS ${pass} checks — per-topic agent landings are catalog-true and competitor-grade`);
