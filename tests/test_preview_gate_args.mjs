/**
 * Contract tests for previewGateArgs / notionalParam — the query validation in
 * front of the FREE gate paths: /gate/swap/preview, and /gate/swap itself when
 * reached via the ?preview=true redirect (src/index.ts).
 *
 *   node tests/test_preview_gate_args.mjs
 *
 * Why this exists: the free path is what probes, agents and the acceptance curl
 * hit to "check before paying", so an invalid param there must 400 — never fall
 * back to a default. Live-observed before this fix (2026-10-28, production):
 *
 *   /gate/swap/preview?token=usdc&side=hodl      -> 200 {side:"buy",  decision:"go"}
 *   /gate/swap/preview?token=usdc&notional=abc   -> 200 {notional_usd:100, decision:"go"}
 *   /gate/swap/preview?token=usdc&notional=-5    -> 200 {notional_usd:100, decision:"go"}
 *
 * A caller asking "is it safe to SELL $250k of this" with a typo in either param
 * was answered for a $100 BUY. That is a GO sized to the wrong trade — the exact
 * fail-open notionalQ's own contract comment says it exists to prevent, undone by
 * the `?? 100` the handler used to apply to its null. These assertions pin the
 * distinction: ABSENT -> documented default (buy, $100); PRESENT-but-INVALID -> 400.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { previewGateArgs, notionalParam, notionalQ } = await import("../src/index.ts");

// Minimal hono-context stub: only .req.query(k) is exercised.
const ctx = (q) => ({ req: { query: (k) => q[k] } });

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

// --- absent params keep the documented free-preview defaults ---------------

check("no params -> buy / $100 default", () => {
  assert.deepStrictEqual(previewGateArgs(ctx({})), { side: "buy", notional: 100 });
});

check("token only -> buy / $100 default", () => {
  assert.deepStrictEqual(previewGateArgs(ctx({ token: "usdc" })), { side: "buy", notional: 100 });
});

check("empty side/notional treated as absent, not invalid", () => {
  assert.deepStrictEqual(previewGateArgs(ctx({ side: "", notional: "" })), { side: "buy", notional: 100 });
});

// --- valid params are honored --------------------------------------------

check("side=sell honored", () => {
  assert.deepStrictEqual(previewGateArgs(ctx({ side: "sell" })), { side: "sell", notional: 100 });
});

check("side is case-insensitive (BUY/SELL), matching the paid route", () => {
  assert.strictEqual(previewGateArgs(ctx({ side: "SELL" })).side, "sell");
  assert.strictEqual(previewGateArgs(ctx({ side: "Buy" })).side, "buy");
});

check("bare notional=1000 honored (the acceptance-check param name)", () => {
  assert.deepStrictEqual(previewGateArgs(ctx({ notional: "1000" })), { side: "buy", notional: 1000 });
});

check("notional_usd honored", () => {
  assert.strictEqual(previewGateArgs(ctx({ notional_usd: "5000" })).notional, 5000);
});

check("camelCase notionalUsd honored (the large-trade alias)", () => {
  assert.strictEqual(previewGateArgs(ctx({ notionalUsd: "250000" })).notional, 250000);
});

check("sell $250k resolved exactly, not coerced to buy/$100", () => {
  assert.deepStrictEqual(previewGateArgs(ctx({ side: "sell", notional: "250000" })), { side: "sell", notional: 250000 });
});

// --- present-but-invalid params MUST 400, never default --------------------

check("REGRESSION: side=hodl -> error, not a silent `buy`", () => {
  const r = previewGateArgs(ctx({ side: "hodl" }));
  assert.ok("error" in r && /side must be buy or sell/.test(r.error), JSON.stringify(r));
});

check("REGRESSION: notional=abc -> error, not a silent $100", () => {
  const r = previewGateArgs(ctx({ notional: "abc" }));
  assert.ok("error" in r && /notional_usd must be a positive number/.test(r.error), JSON.stringify(r));
});

check("REGRESSION: notional=-5 -> error, not a silent $100", () => {
  const r = previewGateArgs(ctx({ notional: "-5" }));
  assert.ok("error" in r, JSON.stringify(r));
});

check("notional=0 -> error (zero is not a trade size)", () => {
  const r = previewGateArgs(ctx({ notional: "0" }));
  assert.ok("error" in r, JSON.stringify(r));
});

check("invalid notional wins even when side is valid", () => {
  const r = previewGateArgs(ctx({ side: "sell", notional: "1e" }));
  assert.ok("error" in r, JSON.stringify(r));
});

check("invalid side reported even when notional is also invalid (no partial result)", () => {
  const r = previewGateArgs(ctx({ side: "hodl", notional: "abc" }));
  assert.ok("error" in r, JSON.stringify(r));
});

// --- notionalParam exposes the present/invalid distinction ---------------

check("notionalParam: absent -> present:false", () => {
  assert.deepStrictEqual(notionalParam(ctx({})), { present: false, value: null });
});

check("notionalParam: present+valid -> present:true + value", () => {
  assert.deepStrictEqual(notionalParam(ctx({ notional: "1000" })), { present: true, value: 1000 });
});

check("notionalParam: present+invalid -> present:true + value:null", () => {
  assert.deepStrictEqual(notionalParam(ctx({ notional: "abc" })), { present: true, value: null });
});

// --- notionalQ's existing alias contract is preserved by the refactor -----

check("notionalQ unchanged: absent 100, valid value, invalid null", () => {
  assert.strictEqual(notionalQ(ctx({})), 100);
  assert.strictEqual(notionalQ(ctx({ notionalUsd: "500000" })), 500000);
  assert.strictEqual(notionalQ(ctx({ notional: "abc" })), null);
  assert.strictEqual(notionalQ(ctx({ notional: "-50" })), null);
});

console.log(`\n# previewGateArgs contract: ${pass}/${pass} passed`);
