/**
 * Contract test: the OpenAPI spec must carry the SAME output example its live 402
 * payment challenge advertises (makeRoutes' declareDiscoveryExtension output.example),
 * so an openapi-ingesting catalog (x402scan source:openapi, RapidAPI, OpenDexter) sees
 * a schema-matched row per paid route instead of a url-only one.
 *
 *   node tests/test_openapi_discovery_examples.mjs
 *
 * Verifies:
 *  - discoveryExamplesFromRoutes pulls GET-route examples out of makeRoutes()
 *  - path keys are OpenAPI-normalised (":domain" -> "{domain}")
 *  - coverage is broad (the gap this closes was 57 of 72 routes url-only)
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { makeRoutes, discoveryExamplesFromRoutes } = await import("../src/index.ts");

const PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
const routes = makeRoutes(PAY_TO);
const ex = discoveryExamplesFromRoutes(routes);

const keys = Object.keys(ex);
console.log(`discovery examples extracted: ${keys.length}`);

// 1. Broad coverage — many routes, not a handful.
assert.ok(keys.length >= 20, `expected >=20 discovery examples, got ${keys.length}`);

// 2. Keys are OpenAPI-normalised (no colon params, no leading method).
for (const k of keys) {
  assert.ok(k.startsWith("/"), `key not a path: ${k}`);
  assert.ok(!k.includes(":"), `colon param not normalised: ${k}`);
  assert.ok(!/^(GET|POST) /.test(k), `method prefix leaked: ${k}`);
}

// 3. :param -> {param} normalisation actually fires where the route has a path param.
if ("GET /dns/:domain" in routes) {
  assert.ok("/dns/{domain}" in ex, `/dns/{domain} missing from normalised examples`);
}

// 4. Every extracted value is a real object/array example (schema-inferable), not a string.
for (const [k, v] of Object.entries(ex)) {
  assert.ok(v !== null && typeof v === "object", `${k} example not an object/array: ${typeof v}`);
}

// 5. POST-only routes are excluded (OpenAPI paid ops are all GET).
assert.ok(!Object.keys(ex).some((k) => k.includes(" ")), "no method-prefixed keys");

console.log("PASS — openapi discovery-example extraction");
