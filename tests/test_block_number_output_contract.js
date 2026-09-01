/**
 * Output-contract tests for GET /chain/block-number.
 * Run: node tests/test_block_number_output_contract.js
 */
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { default: app } = await import("../src/index.ts");

const PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
const BASE_ENV = {
  PAY_TO,
  FACILITATOR_URL: "http://facilitator.test",
  NETWORK: "eip155:8453",
};

function installFetchStub({ rpcFail = false, rpcResult = "0x2a" } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/supported")) {
      return new Response(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
          extensions: [],
          signers: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("mainnet.base.org") || u.includes("base-rpc.publicnode.com")) {
      if (rpcFail) throw new Error("rpc down");
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", result: rpcResult, id: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`test fetch stub hit unexpected URL: ${u}`);
  };
}

function env(extra = {}) {
  return { ...BASE_ENV, ...extra };
}

function assertSuccessShape(body, { allowNote = false } = {}) {
  assert.equal(typeof body.block_number, "number");
  assert.ok(Number.isInteger(body.block_number) && body.block_number >= 0);
  assert.equal(body.chain, "base");
  if (!allowNote) assert.equal("note" in body, false);
}

function decodePaymentRequired(header) {
  const pad = header + "=".repeat((4 - (header.length % 4)) % 4);
  return JSON.parse(Buffer.from(pad, "base64").toString("utf8"));
}

installFetchStub();

const openapiRes = await app.request("/openapi.json", {}, env());
assert.equal(openapiRes.status, 200);
const openapi = await openapiRes.json();
const block200 =
  openapi.paths["/chain/block-number"].get.responses["200"].content["application/json"].schema;
assert.deepEqual(block200.required, ["block_number", "chain"]);
assert.equal(block200.properties.block_number.type, "integer");
assert.equal(block200.properties.block_number.minimum, 0);
assert.deepEqual(block200.properties.chain.enum, ["base"]);
assert.equal(block200.additionalProperties, true);
assert.ok(!block200.required.includes("note"));

const gas200 =
  openapi.paths["/chain/gas-price"].get.responses["200"].content["application/json"].schema;
assert.deepEqual(gas200, { type: "object" });
const prices200 =
  openapi.paths["/crypto/prices"].get.responses["200"].content["application/json"].schema;
assert.deepEqual(prices200, { type: "object" });
console.log("ok 1: OpenAPI GET /chain/block-number requires handler-owned roots; siblings stay bare objects");

const preview = await app.request("/chain/block-number/preview", {}, env());
assert.equal(preview.status, 200);
const previewBody = await preview.json();
assertSuccessShape(previewBody, { allowNote: true });
assert.equal(typeof previewBody.note, "string");
console.log("ok 2: free preview success includes block_number, chain, and optional note");

installFetchStub({ rpcFail: true });
const previewFail = await app.request("/chain/block-number/preview", {}, env());
assert.equal(previewFail.status, 502);
const previewFailBody = await previewFail.json();
assert.equal(typeof previewFailBody.error, "string");
assert.ok(!("block_number" in previewFailBody));
console.log("ok 3: preview RPC failure is 502 with error, not a 200 contract");

installFetchStub();
const unpaid = await app.request("/chain/block-number", {}, env());
assert.equal(unpaid.status, 402);
const pr = unpaid.headers.get("PAYMENT-REQUIRED") || unpaid.headers.get("payment-required");
assert.ok(pr, "unpaid 402 must carry PAYMENT-REQUIRED");
const challenge = decodePaymentRequired(pr);
const accept = (challenge.accepts || [])[0];
assert.equal(accept.amount, "1000");
assert.equal(accept.network, "eip155:8453");
assert.equal(String(accept.payTo).toLowerCase(), PAY_TO.toLowerCase());
const bazaarOut = challenge.extensions?.bazaar?.info?.output;
assert.deepEqual(bazaarOut?.example, { block_number: 27738421, chain: "base" });
// declareDiscoveryExtension merges output.schema into the Bazaar wrapper's
// example property (not info.output.schema). That is the seller-owned discovery
// surface this route can project without forking @x402/extensions.
const exampleSchema = challenge.extensions?.bazaar?.schema?.properties?.output?.properties?.example;
assert.deepEqual(exampleSchema?.required, ["block_number", "chain"]);
assert.equal(exampleSchema?.properties?.block_number?.type, "integer");
assert.deepEqual(exampleSchema?.properties?.chain?.enum, ["base"]);
assert.ok(!exampleSchema?.required?.includes("note"));
const wrapperReq = challenge.extensions?.bazaar?.schema?.properties?.output?.required;
assert.deepEqual(wrapperReq, ["type"]);
console.log("ok 4: unpaid 402 preserves price/payee and projects the same required roots");

const rapidEnv = env({ RAPIDAPI_PROXY_SECRET: "rapidapi-proxy-secret-test-0123456789abcdef" });
const paid200 = await app.request(
  "/chain/block-number",
  { headers: { "X-RapidAPI-Proxy-Secret": rapidEnv.RAPIDAPI_PROXY_SECRET } },
  rapidEnv,
);
assert.equal(paid200.status, 200);
const paidBody = await paid200.json();
assertSuccessShape(paidBody);
assert.equal(paidBody.block_number, 42);
console.log("ok 5: paid success branch returns only handler-owned roots");

installFetchStub({ rpcResult: null });
const paidMalformed = await app.request(
  "/chain/block-number",
  { headers: { "X-RapidAPI-Proxy-Secret": rapidEnv.RAPIDAPI_PROXY_SECRET } },
  rapidEnv,
);
assert.equal(paidMalformed.status, 502);
const paidMalformedBody = await paidMalformed.json();
assert.equal(typeof paidMalformedBody.error, "string");
assert.ok(!("block_number" in paidMalformedBody));
console.log("ok 6: malformed RPC data fails closed instead of violating the integer contract");

installFetchStub({ rpcFail: true });
const paid502 = await app.request(
  "/chain/block-number",
  { headers: { "X-RapidAPI-Proxy-Secret": rapidEnv.RAPIDAPI_PROXY_SECRET } },
  rapidEnv,
);
assert.equal(paid502.status, 502);
const paid502Body = await paid502.json();
assert.equal(typeof paid502Body.error, "string");
assert.ok(!("block_number" in paid502Body));
console.log("ok 7: paid RPC failure is 502 with error, not a 200 offers-style body");

console.log("all block-number output-contract tests passed");
