/**
 * Contract tests for the x402 REPEAT-DEMAND signal
 * (src/index.ts: x402RepeatDemand + the /x402/repeat-demand route registration).
 *
 *   node tests/test_x402_repeat_demand.mjs
 *
 * repeat-demand answers "do this endpoint's payers come BACK?" — the only
 * on-chain signal a paid x402 resource was WORTH paying for. The scan is I/O
 * (Blockscout + RPC), so the verdict core is exercised through x402RepeatDemand
 * with a stubbed global fetch returning a synthetic Blockscout token-transfers
 * page. Claims Law: NO_SETTLEMENTS is never a negative safety verdict; a
 * shared-wallet overcount is disclosed; scope_note always present.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { x402RepeatDemand, makeRoutes, ROUTE_CATALOG } = await import("../src/index.ts");

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const PAYTO = "0x2222222222222222222222222222222222222222";
const P1 = "0x1111111111111111111111111111111111111111";
const P2 = "0x3333333333333333333333333333333333333333";
const P3 = "0x4444444444444444444444444444444444444444";

let pass = 0;
function check(name, fn) { return Promise.resolve(fn()).then(() => { pass++; console.log(`ok - ${name}`); }); }

// Build a Blockscout token-transfers response from a list of [from, usdc, isoTs].
function blockscout(transfers) {
  return {
    items: transfers.map(([from, usdc, ts], i) => ({
      from: { hash: from }, to: { hash: PAYTO },
      token: { address: USDC }, total: { value: String(Math.round(usdc * 1e6)), decimals: "6" },
      timestamp: ts, block_number: 50000000 + i, transaction_hash: "0x" + "a".repeat(63) + i,
    })),
    next_page_params: null,
  };
}

function stubFetch(transfers) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("base.blockscout.com") && u.includes("token-transfers")) {
      return new Response(JSON.stringify(blockscout(transfers)), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected upstream in repeat-demand test: " + u);
  };
}

const savedFetch = globalThis.fetch;

await check("REPEAT_DEMAND when a payer returns (>=2 payments)", async () => {
  // P1 pays 3x, P2 2x, P3 1x -> distinct 3, repeat 2, rate 0.667
  stubFetch([
    [P1, 0.003, "2026-10-01T00:00:00Z"], [P1, 0.003, "2026-10-02T00:00:00Z"], [P1, 0.003, "2026-10-10T00:00:00Z"],
    [P2, 0.004, "2026-10-05T00:00:00Z"], [P2, 0.004, "2026-10-20T00:00:00Z"],
    [P3, 0.005, "2026-10-15T00:00:00Z"],
  ]);
  const r = await x402RepeatDemand(null, PAYTO, null, 1);
  assert.equal(r.verdict, "REPEAT_DEMAND");
  assert.equal(r.distinct_payers, 3);
  assert.equal(r.repeat_payers, 2);
  assert.equal(r.repeat_rate, 0.667);
  assert.equal(r.settlements_scanned, 6);
  assert.ok(Math.abs(r.gross_usdc - (0.009 + 0.008 + 0.005)) < 1e-9);
  assert.equal(r.top_payer.from, P1);
  assert.equal(r.top_payer.payments, 3);
  assert.ok(r.span_days > 18 && r.span_days < 20, `span ${r.span_days}`);
  assert.ok(r.scope_note && r.scope_note.length > 0);
});

await check("SINGLE_USE when no payer returns", async () => {
  stubFetch([[P1, 0.003, "2026-10-01T00:00:00Z"], [P2, 0.004, "2026-10-05T00:00:00Z"], [P3, 0.005, "2026-10-15T00:00:00Z"]]);
  const r = await x402RepeatDemand(null, PAYTO, null, 1);
  assert.equal(r.verdict, "SINGLE_USE");
  assert.equal(r.distinct_payers, 3);
  assert.equal(r.repeat_payers, 0);
  assert.equal(r.repeat_rate, 0);
});

await check("NO_SETTLEMENTS is not a negative safety verdict", async () => {
  stubFetch([]);
  const r = await x402RepeatDemand(null, PAYTO, null, 1);
  assert.equal(r.verdict, "NO_SETTLEMENTS");
  assert.equal(r.distinct_payers, 0);
  assert.ok(/unproven/i.test(r.note) && /Not a negative verdict/i.test(r.note));
});

await check("is_own_endpoint disclosed when payTo is our own wallet", async () => {
  stubFetch([[P1, 0.003, "2026-10-01T00:00:00Z"], [P1, 0.003, "2026-10-02T00:00:00Z"]]);
  const r = await x402RepeatDemand(null, PAYTO, PAYTO, 1);
  assert.equal(r.is_own_endpoint, true);
  assert.ok(/own payTo/i.test(r.note));
});

await check("UNRESOLVED when neither url nor payto resolves a payTo", async () => {
  globalThis.fetch = async () => new Response("not a 402", { status: 200 });
  const r = await x402RepeatDemand("https://seller.example/x402/data", null, null, 1);
  assert.equal(r.verdict, "UNRESOLVED");
  assert.equal(r.payTo, null);
  assert.ok(/could not resolve/i.test(r.note));
});

await check("route registered consistently (catalog + makeRoutes + price $0.003)", async () => {
  const row = ROUTE_CATALOG.find((r) => r[0] === "/x402/repeat-demand");
  assert.ok(row, "ROUTE_CATALOG has /x402/repeat-demand");
  assert.equal(row[2], "0.004");
  assert.equal(row[3], "4000");
  const routes = makeRoutes("0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10");
  const mr = routes["GET /x402/repeat-demand"];
  assert.ok(mr, "makeRoutes gates GET /x402/repeat-demand");
  assert.equal(mr.accepts.price, "$0.004");
});

globalThis.fetch = savedFetch;
console.log(`\n${pass} passed`);
