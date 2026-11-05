/**
 * Contract tests for canonical x402 "upto" scheme interoperability
 * (src/index.ts: makeRoutes UPTO_INTEROP_ROUTES expansion).
 *
 *   node tests/test_upto_scheme_interop.mjs
 *
 * On the highest-frequency DATA routes we ALSO advertise the canonical x402 "upto" scheme
 * (authorize a ceiling via Permit2, settle actual) at the SAME price as "exact", so a
 * standard x402 client that natively constructs upto payments can pay us without the
 * proprietary session rail. Invariants:
 *   - "exact" stays accepts[0] (preferred; every existing payer unchanged).
 *   - upto options exist for every EVM network the exact option is offered on, SAME payTo,
 *     SAME dollar price (flat route => max == actual == price; zero overcharge gap).
 *   - ONLY the designated interop routes get upto; other routes stay exact-only.
 *   - The base-only build (no extra networks) is byte-identical (single-object, exact-only).
 * cfw-hooks shims cloudflare:workers.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { makeRoutes } = await import("../src/index.ts");

const PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
const BASE = "eip155:8453";
const POLY = "eip155:137";
const ARB = "eip155:42161";
const INTEROP = ["GET /crypto/prices", "GET /crypto/funding", "GET /defi/yields"];

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`ok - ${name}`); }

// 1. Each interop route advertises upto for every network its exact option covers, same price.
check("interop routes carry an upto sibling per network at the same price", () => {
  const routes = makeRoutes(PAY_TO, [POLY, ARB]);
  for (const key of INTEROP) {
    const r = routes[key];
    assert.ok(r && Array.isArray(r.accepts), `${key}: accepts is an array`);
    const exact = r.accepts.filter((a) => a.scheme === "exact");
    const upto = r.accepts.filter((a) => a.scheme === "upto");
    assert.strictEqual(exact.length, 3, `${key}: 3 exact options (Base/Poly/Arb)`);
    assert.strictEqual(upto.length, 3, `${key}: 3 upto options (one per EVM network)`);
    const exactNets = new Set(exact.map((a) => a.network));
    for (const u of upto) {
      assert.ok(exactNets.has(u.network), `${key}: upto network ${u.network} has an exact peer`);
      assert.strictEqual(u.payTo, PAY_TO, `${key}: upto payTo preserved`);
      const peer = exact.find((e) => e.network === u.network);
      assert.strictEqual(u.price, peer.price, `${key}: upto price == exact price on ${u.network}`);
      assert.ok(u.network.startsWith("eip155:"), `${key}: upto only on EVM networks`);
    }
  }
});

// 2. exact stays accepts[0] — no existing payer is disturbed.
check("exact remains accepts[0] on every interop route", () => {
  const routes = makeRoutes(PAY_TO, [POLY, ARB]);
  for (const key of INTEROP) {
    const r = routes[key];
    assert.strictEqual(r.accepts[0].scheme, "exact", `${key}: accepts[0].scheme == exact`);
    assert.strictEqual(r.accepts[0].network, BASE, `${key}: accepts[0].network == Base`);
  }
});

// 3. ONLY interop routes get upto; a non-interop priced route stays exact-only.
check("non-interop routes do NOT advertise upto", () => {
  const routes = makeRoutes(PAY_TO, [POLY, ARB]);
  for (const key of Object.keys(routes)) {
    if (INTEROP.includes(key)) continue;
    const a = routes[key].accepts;
    const opts = Array.isArray(a) ? a : [a];
    const hasUpto = opts.some((o) => o && o.scheme === "upto");
    assert.ok(!hasUpto, `${key}: must not carry an upto option (not an interop route)`);
  }
});

// 4. Base-only build is byte-identical: single-object accepts, exact-only (no upto leak).
check("base-only build stays single-object exact-only (no upto, no array)", () => {
  const routes = makeRoutes(PAY_TO);
  for (const key of INTEROP) {
    const r = routes[key];
    assert.ok(!Array.isArray(r.accepts), `${key}: base-only accepts is NOT an array`);
    assert.strictEqual(r.accepts.scheme, "exact", `${key}: base-only scheme is exact`);
  }
  const anyUpto = Object.keys(routes).some((k) => {
    const a = routes[k].accepts;
    const opts = Array.isArray(a) ? a : [a];
    return opts.some((o) => o && o.scheme === "upto");
  });
  assert.ok(!anyUpto, "base-only build advertises zero upto options");
});

console.log(`\n${pass} checks passed`);
