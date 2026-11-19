/**
 * Contract test: every BILLABLE POST route in ROUTE_CATALOG must be published in
 * /openapi.json as a real POST operation, with advertised price == the amount the
 * live 402 charges. The OpenAPI spec is the canonical discovery format openapi-first
 * x402 wallet clients (AgentCash, DopamineDesk mcp-server-aidatamarketplace) read
 * before the runtime-402 fallback; a billable POST absent here is undiscoverable to
 * exactly the clients that buy that category. The spec shipped 75 GET + 0 POST for a
 * long time (the chat route, our only route in the measured top repeat-purchase
 * category, was invisible) because nothing asserted POST coverage. This guards it.
 *
 *   node tests/test_openapi_post_routes.mjs
 *
 * The expected set is DERIVED from ROUTE_CATALOG (method === "POST"), never a
 * hardcoded path list, so it tracks the catalog as routes are added/removed.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app, ROUTE_CATALOG, routePriceAtomic } = await import("../src/index.ts");

const PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
const env = {
  PAY_TO, NETWORK: "eip155:8453", FACILITATOR_URL: "http://facilitator.test",
  USAGE_COUNTER: { idFromName: (x) => x, get: () => ({ async fetch() { return Response.json({}); } }) },
};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (["http://facilitator.test/supported", "https://facilitator.xpay.sh/supported"].includes(u))
    return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }], extensions: [], signers: {} });
  throw Error("unexpected upstream in openapi-post test: " + u);
};

const oas = await (await app.request("/openapi.json", {}, env)).json();

// Derive the billable POST paths from the catalog (single source of truth).
const postPaths = ROUTE_CATALOG.filter((r) => r[1] === "POST").map((r) => r[0]);
assert.ok(postPaths.length >= 1, "ROUTE_CATALOG declares no POST routes — did the catalog shape change?");

let checked = 0;
for (const p of postPaths) {
  const op = oas.paths?.[p]?.post;
  assert.ok(op, `billable POST ${p} is in ROUTE_CATALOG but MISSING from /openapi.json`);
  assert.equal(op["x-billable"], true, `${p}: not marked x-billable in openapi`);
  assert.equal(op["x-availability"], "operational", `${p}: not x-availability=operational`);
  assert.ok(op.operationId, `${p}: no operationId (breaks discover->purchase handoff)`);
  assert.ok(op.responses?.["402"], `${p}: no 402 response declared`);
  assert.equal(typeof op["x-price-usdc"], "number", `${p}: x-price-usdc not a number`);

  // advertised == charged: both numeric forms equal the live 402 atomic/1e6.
  const atomic = routePriceAtomic(p, "POST", PAY_TO);
  assert.ok(atomic && atomic > 0, `${p}: routePriceAtomic returned no live price`);
  const charged = atomic / 1e6;
  assert.equal(op["x-price-usdc"], charged, `${p}: openapi x-price-usdc ${op["x-price-usdc"]} != live 402 charge ${charged}`);
  assert.equal(parseFloat(op["x-payment-info"]?.price?.amount), charged, `${p}: x-payment-info.amount != live 402 charge ${charged}`);
  checked++;
}

// The chat route is the headline: openapi-first buyers need input AND output schema.
const chat = oas.paths?.["/v1/chat/completions"]?.post;
if (chat) {
  assert.ok(chat.requestBody?.content?.["application/json"]?.schema?.properties?.messages, "chat: no request messages schema");
  assert.ok(chat.requestBody?.content?.["application/json"]?.example, "chat: no request example");
  assert.ok(chat.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.choices, "chat: no 200 choices schema");
  assert.ok(chat.responses?.["200"]?.content?.["application/json"]?.example?.choices, "chat: no 200 example");
}

console.log(`ok - ${checked} billable POST route(s) published in openapi.json, advertised == live 402 charge`);
console.log("PASS - openapi POST coverage");
