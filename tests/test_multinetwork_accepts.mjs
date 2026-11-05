/**
 * Contract tests for multi-network accepts[] (src/index.ts: makeRoutes extraNetworks).
 *
 *   node tests/test_multinetwork_accepts.mjs
 *
 * The live 402 money gate must stay byte-identical for Base-holding agents: Base is
 * always accepts[0] and, with no extra networks, accepts stays a single object exactly
 * as before. Extra EVM networks (Polygon 137, Arbitrum 42161) are offered as ADDITIONAL
 * options at the SAME dollar price so an agent holding USDC on those chains can pay us
 * instead of bouncing. cfw-hooks shims cloudflare:workers.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { makeRoutes } = await import("../src/index.ts");

const PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
const BASE = "eip155:8453";
const POLY = "eip155:137";
const ARB = "eip155:42161";

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`ok - ${name}`); }

// 1. No extra networks => accepts stays a SINGLE object on Base (byte-identical to before).
check("base-only: accepts is a single Base object (no regression)", () => {
  const routes = makeRoutes(PAY_TO);
  const r = routes["GET /crypto/prices"];
  assert.ok(r && typeof r === "object", "route present");
  assert.ok(!Array.isArray(r.accepts), "accepts is NOT an array when no extra networks");
  assert.strictEqual(r.accepts.network, BASE, "network is Base");
  assert.strictEqual(r.accepts.payTo, PAY_TO, "payTo preserved");
  assert.ok(String(r.accepts.price).startsWith("$"), "dollar price preserved");
});

// 2. With extra networks => accepts is an array; Base is FIRST (primary, unchanged).
check("multi-network: accepts[0] is Base, unchanged", () => {
  const routes = makeRoutes(PAY_TO, [POLY, ARB]);
  const r = routes["GET /crypto/prices"];
  assert.ok(Array.isArray(r.accepts), "accepts is an array");
  assert.strictEqual(r.accepts.length, 3, "Base + Polygon + Arbitrum = 3 options");
  assert.strictEqual(r.accepts[0].network, BASE, "Base is accepts[0] (primary)");
  assert.strictEqual(r.accepts[0].payTo, PAY_TO, "Base payTo preserved");
});

// 3. Extra options carry the right networks, same payTo, same dollar price, no stale asset.
check("multi-network: extra options are Polygon + Arbitrum at same price, same payTo", () => {
  const routes = makeRoutes(PAY_TO, [POLY, ARB]);
  const r = routes["GET /crypto/prices"];
  const nets = r.accepts.map((a) => a.network);
  assert.deepStrictEqual(nets, [BASE, POLY, ARB], "network order Base,Polygon,Arbitrum");
  const price0 = r.accepts[0].price;
  for (const a of r.accepts) {
    assert.strictEqual(a.payTo, PAY_TO, "same payTo on every option (EVM address is chain-agnostic)");
    assert.strictEqual(a.price, price0, "same dollar price across networks");
    assert.strictEqual(a.scheme, "exact", "exact scheme");
    // We do NOT hardcode a per-chain asset here — the scheme resolves it from DEFAULT_ASSETS.
    assert.ok(!("asset" in a) || a.asset === undefined || a.network === BASE, "no cross-chain asset mismatch injected");
  }
});

// 4. Every priced route gets the same treatment (not just one).
check("multi-network: applied across all Base routes", () => {
  const single = makeRoutes(PAY_TO);
  const multi = makeRoutes(PAY_TO, [POLY, ARB]);
  let converted = 0, baseFirst = 0;
  for (const key of Object.keys(multi)) {
    const a = multi[key].accepts;
    if (Array.isArray(a)) {
      converted++;
      if (a[0].network === BASE) baseFirst++;
    }
  }
  assert.ok(converted > 10, `expected many routes converted, got ${converted}`);
  assert.strictEqual(converted, baseFirst, "EVERY converted route keeps Base as accepts[0]");
  // single build left them all as objects
  const singleArrays = Object.keys(single).filter((k) => Array.isArray(single[k].accepts)).length;
  assert.strictEqual(singleArrays, 0, "base-only build has zero array accepts (byte-identical)");
});

console.log(`\n${pass} checks passed`);
