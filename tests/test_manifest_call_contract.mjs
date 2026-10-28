/**
 * Contract test for the machine-readable call contracts in /.well-known/x402.
 *
 *   node tests/test_manifest_call_contract.mjs
 *
 * WHY (measured 2026-10-28 against Agent402's live seller row for this origin):
 * our flagship routes already qualify for the Base unproven tier
 * (routerDispatchByChain.base.unprovenTier=true, unprovenMaxUsd=0.01, EIP-712
 * domain clean, payTo un-shared) — the one missing thing for a Smart Order Router
 * to actually DISPATCH + pay us is a CONSTRUCTIBLE call: the input params, which
 * are required, and a runnable example. The manifest historically published only
 * description + tags. manifestCallContract adds name/category/inputSchema/required/
 * example additively (degrade-open — unknown fields ignored by routers that don't
 * read them; param names are the real query keys the handlers read, no vaporware).
 * This test locks the contract against the real export. Node >= 22.18 strips TS
 * types on import; cfw-hooks.mjs shims cloudflare:workers.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { manifestCallContract, ROUTE_CATALOG } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// (1) Flagship token-report: dense name carries the rare high-value term, required
//     token param, runnable example that resolves (demo alias).
{
  const cc = manifestCallContract("/chain/token-report", "Is this Base token safe to buy? …", ["security", "token", "honeypot"]);
  ok(/honeypot|rug/i.test(cc.name), "token-report name front-loads a rare term");
  ok(cc.name.length <= 100, "name stays a name, not a doc");
  eq(cc.category, "crypto", "token-report category");
  ok(cc.inputSchema && cc.inputSchema.type === "object", "token-report has an object inputSchema");
  ok(Array.isArray(cc.required) && cc.required.includes("token"), "token is required");
  ok(cc.example && typeof cc.example.token === "string", "token-report carries a runnable example");
}

// (2) gate/swap: required token, optional side with an enum, optional notional.
{
  const cc = manifestCallContract("/gate/swap", "Is this Base token safe to swap …", ["security", "gate"]);
  ok(cc.required.includes("token") && !cc.required.includes("side"), "gate/swap: token required, side optional");
  ok(Array.isArray(cc.inputSchema.properties.side.enum) && cc.inputSchema.properties.side.enum.includes("buy"), "side enum present");
}

// (3) No-param route stated in the description → explicit EMPTY inputSchema (the
//     easiest-to-dispatch signal: callable with no args), no required[].
{
  const row = ROUTE_CATALOG.find((r) => r[0] === "/defi/chains-tvl");
  const cc = manifestCallContract(row[0], row[4], row[5]);
  ok(cc.inputSchema && cc.inputSchema.type === "object", "chains-tvl has an inputSchema");
  eq(Object.keys(cc.inputSchema.properties).length, 0, "chains-tvl inputSchema has no params");
  ok(cc.required === undefined, "chains-tvl has no required[]");
  ok(cc.example === undefined, "chains-tvl has no example");
}

// (4) Degrade-open: a route NOT in the map still yields a derived name + category
//     and (when the description does not declare no-params) omits inputSchema
//     rather than inventing one.
{
  const cc = manifestCallContract("/chain/storage-at", "Raw storage slot read (eth_getStorageAt) for any Base contract; slot defaults to 0x0.", ["rpc", "base"]);
  ok(typeof cc.name === "string" && cc.name.length > 0, "derived name present");
  eq(cc.category, "blockchain", "rpc route → blockchain category");
  ok(cc.inputSchema === undefined, "unmapped non-no-param route omits inputSchema (no vaporware)");
}

// (5) Never throws + always returns a name+category for EVERY catalog route, and
//     every required param is a declared property (schema self-consistency).
for (const [p, , , , desc, tags] of ROUTE_CATALOG) {
  const cc = manifestCallContract(p, desc, tags);
  ok(typeof cc.name === "string" && cc.name.length > 0, `name for ${p}`);
  ok(typeof cc.category === "string" && cc.category.length > 0, `category for ${p}`);
  if (cc.required) {
    for (const r of cc.required) {
      ok(cc.inputSchema.properties[r] !== undefined, `${p}: required '${r}' is a declared property`);
    }
  }
  if (cc.example) {
    for (const k of Object.keys(cc.example)) {
      ok(cc.inputSchema.properties[k] !== undefined, `${p}: example key '${k}' is a declared property`);
    }
  }
}

console.log(`test_manifest_call_contract: ${pass} checks passed`);
