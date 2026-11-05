/**
 * Contract test for the V1-style typed-search discovery projection onto the
 * per-request 402 accepts[] body.
 *
 *   node tests/test_402_typed_discovery.mjs
 *
 * x402scan TYPED search and CDP Bazaar quality-index resolve a seller's input
 * JSON Schema PER OFFER (the V1 shape: outputSchema.input.schema on each
 * accepts[] entry), while the @x402/hono V2 middleware only emits that schema at
 * the top level / inside extensions.bazaar. enrichAcceptsWithV1Discovery projects
 * the top-level `resource` + `extensions.bazaar` block DOWN onto each offer so a
 * typed catalog search resolves our routes. This test locks:
 *   (a) each offer gains resource (URL string) / maxAmountRequired / mimeType;
 *   (b) outputSchema.input.schema carries the real JSON Schema (the x402scan gate)
 *       and output carries the example (the CDP catalog item);
 *   (c) the projection is pure data already in the body (no new facts invented);
 *   (d) the signed EIP-712 fields are untouched (settlement-safe);
 *   (e) it degrades open (no bazaar block → no throw, still adds the cheap fields);
 *   (f) existing offer fields are never overwritten (idempotent-safe).
 *
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips the TS
 * types on import.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { enrichAcceptsWithV1Discovery } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// A realistic V2 402 body as emitted by the @x402/hono middleware for a GET
// route (shape verified against the live /defi/yields 402).
function freshBody() {
  return {
    x402Version: 2,
    error: "payment required",
    resource: {
      url: "https://api.greyridgesignals.ai/defi/yields",
      description: "Top DeFi lending/LP yields",
      mimeType: "application/json",
      serviceName: "Top DeFi Yields & APY",
      tags: ["defi", "yield"],
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "1000",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10",
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2", decimals: 6 },
      },
    ],
    extensions: {
      bazaar: {
        info: {
          input: { type: "http", method: "GET", queryParams: { limit: "20", project: "aave-v3" } },
          output: { type: "json", example: { project: "aave-v3", apy: 4.21, pool: "747c1d2a" } },
        },
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            input: {
              type: "object",
              properties: { type: { type: "string", const: "http" }, method: { type: "string" } },
              required: ["type", "method"],
            },
          },
          required: ["input"],
        },
      },
    },
  };
}

// --- (a) + (b) GET route: offer gains the V1 discovery fields ---------------
{
  const body = freshBody();
  enrichAcceptsWithV1Discovery(body, "/defi/yields");
  const o = body.accepts[0];
  eq(o.resource, "https://api.greyridgesignals.ai/defi/yields", "offer.resource = the top-level resource URL string");
  eq(o.maxAmountRequired, "1000", "offer.maxAmountRequired mirrors amount");
  eq(o.mimeType, "application/json", "offer.mimeType set");
  ok(o.outputSchema && o.outputSchema.input, "outputSchema.input present");
  // The x402scan typed-search gate: a JSON Schema must live at outputSchema.input.schema.
  ok(o.outputSchema.input.schema && o.outputSchema.input.schema.$schema === "https://json-schema.org/draft/2020-12/schema",
    "outputSchema.input.schema carries a JSON Schema ($schema set) — the x402scan typed-search gate");
  eq(o.outputSchema.input.method, "GET", "outputSchema.input.method from bazaar info");
  ok(o.outputSchema.input.queryParams && o.outputSchema.input.queryParams.limit === "20",
    "outputSchema.input.queryParams carries the example values (CDP gate)");
  ok(o.outputSchema.output && o.outputSchema.output.apy === 4.21,
    "outputSchema.output carries the bazaar example object (CDP catalog item)");
}

// --- (c) projection invents no new facts: schema === the body's bazaar schema input
{
  const body = freshBody();
  const srcInput = body.extensions.bazaar.schema.properties.input;
  enrichAcceptsWithV1Discovery(body, "/defi/yields");
  const projected = body.accepts[0].outputSchema.input.schema;
  // Same required[] and same property keys — a projection, not a fabrication.
  assert.deepStrictEqual(projected.required, srcInput.required, "projected schema.required === bazaar schema input.required"); pass++;
  assert.deepStrictEqual(Object.keys(projected.properties), Object.keys(srcInput.properties),
    "projected schema properties === bazaar schema input properties"); pass++;
}

// --- (d) settlement-safe: the signed EIP-712 fields are untouched -----------
{
  const body = freshBody();
  const before = JSON.parse(JSON.stringify(body.accepts[0]));
  enrichAcceptsWithV1Discovery(body, "/defi/yields");
  const o = body.accepts[0];
  eq(o.scheme, before.scheme, "scheme unchanged");
  eq(o.network, before.network, "network unchanged");
  eq(o.amount, before.amount, "amount unchanged");
  eq(o.asset, before.asset, "asset unchanged");
  eq(o.payTo, before.payTo, "payTo unchanged");
  eq(o.maxTimeoutSeconds, before.maxTimeoutSeconds, "maxTimeoutSeconds unchanged");
  assert.deepStrictEqual(o.extra, before.extra, "extra (EIP-712 domain name/version + decimals) unchanged"); pass++;
}

// --- (e) degrade-open: no bazaar block → no throw, still adds cheap fields --
{
  const body = freshBody();
  delete body.extensions;
  assert.doesNotThrow(() => enrichAcceptsWithV1Discovery(body, "/defi/yields"), "no bazaar block → never throws"); pass++;
  const o = body.accepts[0];
  eq(o.resource, "https://api.greyridgesignals.ai/defi/yields", "resource still projected from top-level resource");
  eq(o.maxAmountRequired, "1000", "maxAmountRequired still set");
  eq(o.mimeType, "application/json", "mimeType still set");
  eq(o.outputSchema, undefined, "no outputSchema when there is no schema/example to project (no fabrication)");
}

// --- (e2) no top-level resource AND no bazaar → fallback origin + path -------
{
  const body = freshBody();
  delete body.extensions;
  delete body.resource;
  enrichAcceptsWithV1Discovery(body, "/crypto/prices", "https://x402-data-api.sigrunner.workers.dev");
  eq(body.accepts[0].resource, "https://x402-data-api.sigrunner.workers.dev/crypto/prices",
    "resource falls back to origin+path when top-level resource is absent");
}

// --- (f) never overwrites an existing offer field (idempotent-safe) ---------
{
  const body = freshBody();
  body.accepts[0].resource = "https://preset.example/x";
  body.accepts[0].mimeType = "text/csv";
  enrichAcceptsWithV1Discovery(body, "/defi/yields");
  eq(body.accepts[0].resource, "https://preset.example/x", "preset resource is not overwritten");
  eq(body.accepts[0].mimeType, "text/csv", "preset mimeType is not overwritten");
}

// --- (f2) running twice is stable (idempotent) ------------------------------
{
  const body = freshBody();
  enrichAcceptsWithV1Discovery(body, "/defi/yields");
  const once = JSON.stringify(body.accepts[0]);
  enrichAcceptsWithV1Discovery(body, "/defi/yields");
  eq(JSON.stringify(body.accepts[0]), once, "second projection is a no-op (idempotent)");
}

// --- (g) non-array / empty accepts → returns unchanged, no throw ------------
{
  assert.doesNotThrow(() => enrichAcceptsWithV1Discovery({}, "/x"), "no accepts → no throw"); pass++;
  assert.doesNotThrow(() => enrichAcceptsWithV1Discovery(null, "/x"), "null body → no throw"); pass++;
}

console.log(`\n✓ 402 typed-discovery projection contract: ${pass} checks passed`);
