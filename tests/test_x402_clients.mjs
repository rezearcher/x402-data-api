/**
 * Contract tests for the x402 PAYER-ROSTER + concentration signal
 * (src/index.ts: x402Clients + the /x402/clients route registration).
 *
 *   node tests/test_x402_clients.mjs
 *
 * clients answers "WHO pays this endpoint, and is the volume broad demand or one
 * whale?" — the per-payer roster + a concentration verdict the repeat-demand
 * aggregate hides. The scan is I/O (Blockscout + RPC), so the verdict core is
 * exercised through x402Clients with a stubbed global fetch returning a synthetic
 * Blockscout token-transfers page. Claims Law: NO_SETTLEMENTS is never a negative
 * safety verdict; a shared-wallet overcount is disclosed; scope_note always present.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { x402Clients, makeRoutes, ROUTE_CATALOG } = await import("../src/index.ts");

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const PAYTO = "0x2222222222222222222222222222222222222222";
const P1 = "0x1111111111111111111111111111111111111111";
const P2 = "0x3333333333333333333333333333333333333333";
const P3 = "0x4444444444444444444444444444444444444444";

let pass = 0;
function check(name, fn) { return Promise.resolve(fn()).then(() => { pass++; console.log(`ok - ${name}`); }); }

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
    throw new Error("unexpected upstream in clients test: " + u);
  };
}

const savedFetch = globalThis.fetch;

await check("DISTRIBUTED when no single wallet dominates gross", async () => {
  // Three payers, roughly even gross -> top share < 0.6
  stubFetch([
    [P1, 0.004, "2026-10-01T00:00:00Z"], [P1, 0.004, "2026-10-02T00:00:00Z"],
    [P2, 0.004, "2026-10-05T00:00:00Z"], [P2, 0.004, "2026-10-20T00:00:00Z"],
    [P3, 0.004, "2026-10-15T00:00:00Z"], [P3, 0.004, "2026-10-18T00:00:00Z"],
  ]);
  const r = await x402Clients(null, PAYTO, null, 1, 20);
  assert.equal(r.verdict, "DISTRIBUTED");
  assert.equal(r.distinct_payers, 3);
  assert.equal(r.settlements_scanned, 6);
  assert.ok(r.concentration.top_payer_share < 0.6, `top share ${r.concentration.top_payer_share}`);
  assert.equal(r.clients.length, 3);
  // roster sorted by payments desc; all three tie at 2 payments
  assert.ok(r.clients.every((e) => e.payments === 2));
  assert.ok(r.clients.every((e) => e.is_repeat === true));
  assert.ok(Math.abs(r.clients.reduce((a, e) => a + e.share, 0) - 1) < 0.05, "shares ~sum to 1");
  assert.ok(r.scope_note && r.scope_note.length > 0);
});

await check("CONCENTRATED when one wallet dominates gross (>=60%)", async () => {
  // P1 has 0.1 gross, P2 + P3 tiny -> P1 share ~0.9
  stubFetch([
    [P1, 0.05, "2026-10-01T00:00:00Z"], [P1, 0.05, "2026-10-02T00:00:00Z"],
    [P2, 0.005, "2026-10-05T00:00:00Z"],
    [P3, 0.005, "2026-10-15T00:00:00Z"],
  ]);
  const r = await x402Clients(null, PAYTO, null, 1, 20);
  assert.equal(r.verdict, "CONCENTRATED");
  assert.equal(r.distinct_payers, 3);
  assert.ok(r.concentration.top_payer_share >= 0.6, `top share ${r.concentration.top_payer_share}`);
  assert.ok(r.concentration.hhi > 0 && r.concentration.hhi <= 1);
  assert.ok(r.concentration.effective_payers >= 1 && r.concentration.effective_payers <= r.distinct_payers);
  assert.equal(r.clients[0].from, P1); // top by payments then gross
  assert.ok(/concentrated|overstates/i.test(r.note));
});

await check("SINGLE_PAYER when every settlement is one wallet", async () => {
  stubFetch([
    [P1, 0.003, "2026-10-01T00:00:00Z"], [P1, 0.003, "2026-10-02T00:00:00Z"], [P1, 0.003, "2026-10-10T00:00:00Z"],
  ]);
  const r = await x402Clients(null, PAYTO, null, 1, 20);
  assert.equal(r.verdict, "SINGLE_PAYER");
  assert.equal(r.distinct_payers, 1);
  assert.equal(r.clients.length, 1);
  assert.equal(r.clients[0].payments, 3);
  assert.equal(r.concentration.top_payer_share, 1);
  assert.ok(/one payer|captive/i.test(r.note));
});

await check("per-payer first/last seen populated from the scan", async () => {
  stubFetch([
    [P1, 0.003, "2026-10-01T00:00:00Z"], [P1, 0.003, "2026-10-20T00:00:00Z"],
    [P2, 0.003, "2026-10-10T00:00:00Z"],
  ]);
  const r = await x402Clients(null, PAYTO, null, 1, 20);
  const p1 = r.clients.find((e) => e.from === P1);
  assert.ok(p1.first_seen && p1.last_seen, "p1 timestamps present");
  assert.ok(new Date(p1.first_seen) < new Date(p1.last_seen), "first before last");
  assert.ok(p1.first_seen.startsWith("2026-10-01"), p1.first_seen);
  assert.ok(p1.last_seen.startsWith("2026-10-20"), p1.last_seen);
});

await check("limit truncates roster and flags clients_truncated", async () => {
  stubFetch([
    [P1, 0.004, "2026-10-01T00:00:00Z"], [P2, 0.003, "2026-10-05T00:00:00Z"], [P3, 0.002, "2026-10-15T00:00:00Z"],
  ]);
  const r = await x402Clients(null, PAYTO, null, 1, 2);
  assert.equal(r.distinct_payers, 3);
  assert.equal(r.clients.length, 2);
  assert.equal(r.clients_returned, 2);
  assert.equal(r.clients_truncated, true);
});

await check("NO_SETTLEMENTS is not a negative safety verdict", async () => {
  stubFetch([]);
  const r = await x402Clients(null, PAYTO, null, 1, 20);
  assert.equal(r.verdict, "NO_SETTLEMENTS");
  assert.equal(r.distinct_payers, 0);
  assert.equal(r.clients.length, 0);
  assert.equal(r.concentration, null);
  assert.ok(/Not a negative verdict/i.test(r.note));
});

await check("is_own_endpoint disclosed when payTo is our own wallet", async () => {
  stubFetch([[P1, 0.003, "2026-10-01T00:00:00Z"], [P2, 0.003, "2026-10-02T00:00:00Z"]]);
  const r = await x402Clients(null, PAYTO, PAYTO, 1, 20);
  assert.equal(r.is_own_endpoint, true);
  assert.ok(/own payTo/i.test(r.note));
});

await check("UNRESOLVED when neither url nor payto resolves a payTo", async () => {
  globalThis.fetch = async () => new Response("not a 402", { status: 200 });
  const r = await x402Clients("https://seller.example/x402/data", null, null, 1, 20);
  assert.equal(r.verdict, "UNRESOLVED");
  assert.equal(r.payTo, null);
  assert.ok(/could not resolve/i.test(r.note));
});

await check("route registered consistently (catalog + makeRoutes + magnet price $0.001)", async () => {
  const row = ROUTE_CATALOG.find((r) => r[0] === "/x402/clients");
  assert.ok(row, "ROUTE_CATALOG has /x402/clients");
  assert.equal(row[2], "0.001");
  assert.equal(row[3], "1000");
  const routes = makeRoutes("0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10");
  const mr = routes["GET /x402/clients"];
  assert.ok(mr, "makeRoutes gates GET /x402/clients");
  assert.equal(mr.accepts.price, "$0.001");
});

globalThis.fetch = savedFetch;
console.log(`\n${pass} passed`);
