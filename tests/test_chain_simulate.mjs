/**
 * Contract test for the prospective-transaction dry-run route /chain/simulate.
 *
 *   node tests/test_chain_simulate.mjs
 *
 * The chain lane is served by on-chain EXECUTION bots (nonce/gas/receipt/tx/
 * token-balance/allowance = classic pre-send checks) but we had NO prospective-
 * transaction simulation route — the single highest-value pre-trade primitive and
 * the literal Line-A thesis. /chain/simulate runs eth_simulateV1 on a caller-
 * supplied {from,to,data,value} and returns will_revert + revert_reason + gas_used
 * + token asset_changes BEFORE the agent spends gas. This test locks:
 *   (1) decodeRevertReason decodes Error(string) + Panic(uint256), null otherwise,
 *   (2) parseSimTransfers folds traceTransfers Transfer logs → deltas (pure),
 *   (3) simulateTx degrades open (all RPC fail → available:false, never throws),
 *   (4) simulateTx success path → will_revert:false + gas_used + asset_changes,
 *   (5) simulateTx revert path → will_revert:true + decoded revert_reason,
 *   (6) the route is in ROUTE_CATALOG at $0.005 tagged chain+data,
 *   (7) makeRoutes 402-gates GET /chain/simulate at $0.005,
 *   (8) see_also cross-sell fires and never points back at self.
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const {
  decodeRevertReason,
  parseSimTransfers,
  simulateTx,
  ROUTE_CATALOG,
  buildSeeAlso,
  makeRoutes,
} = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// A real abi.encode of Error("INSUFFICIENT_OUTPUT_AMOUNT") = selector + offset(32) +
// len(32) + utf8 bytes right-padded. Build it so the decoder is tested on a live payload.
function encodeErrorString(s) {
  const bytes = Buffer.from(s, "utf8");
  const len = bytes.length.toString(16).padStart(64, "0");
  const offset = (32).toString(16).padStart(64, "0");
  const dataHex = Buffer.concat([bytes, Buffer.alloc((32 - (bytes.length % 32)) % 32)]).toString("hex");
  return "0x08c379a0" + offset + len + dataHex;
}

// (1) decodeRevertReason
{
  eq(decodeRevertReason(encodeErrorString("INSUFFICIENT_OUTPUT_AMOUNT")), "INSUFFICIENT_OUTPUT_AMOUNT", "decodes Error(string)");
  eq(decodeRevertReason("0x4e487b71" + (17).toString(16).padStart(64, "0")), "Panic(0x11)", "decodes Panic(uint256) code");
  eq(decodeRevertReason("0x"), null, "empty returnData → null");
  eq(decodeRevertReason(undefined), null, "undefined returnData → null");
  eq(decodeRevertReason("0xdeadbeef"), null, "custom error selector → null (still reported as revert, no string)");
}

// (2) parseSimTransfers — pure fold of traceTransfers logs
{
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const from = "0x" + "11".repeat(20);
  const to = "0x" + "22".repeat(20);
  const topicAddr = (a) => "0x" + a.slice(2).padStart(64, "0");
  const logs = [
    { address: "0xTOKENaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", topics: [TRANSFER, topicAddr(from), topicAddr(to)], data: "0x" + (1000n).toString(16).padStart(64, "0") },
    { address: "0xNOISE", topics: ["0xabcdef", topicAddr(from), topicAddr(to)], data: "0x01" }, // non-Transfer topic → ignored
    { address: "0xNATIVE", topics: [TRANSFER, topicAddr(from), topicAddr(to)], data: "0x" }, // zero-amount native move
  ];
  const changes = parseSimTransfers(logs);
  eq(changes.length, 2, "only the two Transfer-topic logs are kept");
  eq(changes[0].amount, "1000", "amount decoded from data");
  eq(changes[0].from.toLowerCase(), from.toLowerCase(), "from recovered from topic[1]");
  eq(changes[0].to.toLowerCase(), to.toLowerCase(), "to recovered from topic[2]");
  eq(changes[1].amount, "0", "empty data → amount 0");
  eq(parseSimTransfers(undefined).length, 0, "undefined logs → empty, no throw");
}

// mock helper: force rpcOrder's fetch to return a canned eth_simulateV1 result
function withFetch(fn, body) {
  const real = globalThis.fetch;
  globalThis.fetch = fn;
  return (async () => { try { return await body(); } finally { globalThis.fetch = real; } })();
}

// (3) degrade-open: every RPC errors → available:false, no throw
await withFetch(
  async () => ({ ok: false, status: 500, json: async () => ({}) }),
  async () => {
    const r = await simulateTx("0x" + "11".repeat(20), "0x" + "22".repeat(20), "0x", 0n);
    eq(r.available, false, "all-RPC-fail → available:false");
    eq(r.will_revert, null, "unavailable → will_revert null (no false verdict)");
  },
);

// (4) success path: status 0x1 + gas + a Transfer log → packaged result
await withFetch(
  async () => ({
    ok: true, status: 200,
    json: async () => ({
      result: [{ calls: [{
        status: "0x1",
        gasUsed: "0x5208", // 21000
        returnData: "0x",
        logs: [{ address: "0x" + "ab".repeat(20), topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x" + ("0x" + "11".repeat(20)).slice(2).padStart(64, "0"),
          "0x" + ("0x" + "22".repeat(20)).slice(2).padStart(64, "0"),
        ], data: "0x" + (500n).toString(16).padStart(64, "0") }],
      }] }],
    }),
  }),
  async () => {
    const r = await simulateTx("0x" + "11".repeat(20), "0x" + "22".repeat(20), "0x", 0n);
    eq(r.available, true, "success → available:true");
    eq(r.will_revert, false, "status 0x1 → will_revert:false");
    eq(r.gas_used, 21000, "gasUsed 0x5208 → 21000 decimal");
    eq(r.asset_changes.length, 1, "one asset change parsed");
    eq(r.asset_changes[0].amount, "500", "asset change amount");
  },
);

// (5) revert path: status 0x0 + Error(string) returnData → decoded reason
await withFetch(
  async () => ({
    ok: true, status: 200,
    json: async () => ({
      result: [{ calls: [{ status: "0x0", gasUsed: "0x6f54", returnData: encodeErrorString("TRANSFER_FROM_FAILED"), logs: [] }] }],
    }),
  }),
  async () => {
    const r = await simulateTx("0x" + "11".repeat(20), "0x" + "22".repeat(20), "0xdeadbeef", 0n);
    eq(r.will_revert, true, "status 0x0 → will_revert:true");
    eq(r.revert_reason, "TRANSFER_FROM_FAILED", "Error(string) decoded into revert_reason");
    eq(r.asset_changes.length, 0, "no transfers on a reverting call");
  },
);

// (6) ROUTE_CATALOG registration at $0.005, tagged chain + data
{
  const row = ROUTE_CATALOG.find((r) => r[0] === "/chain/simulate");
  ok(!!row, "/chain/simulate is in ROUTE_CATALOG");
  eq(row[1], "GET", "catalog method GET");
  eq(row[2], "0.005", "catalog price 0.005");
  ok(row[5].includes("data"), "tagged data (discoverable + see_also-eligible)");
  ok(row[5].includes("chain"), "tagged chain");
  ok(row[5].includes("pre-trade"), "tagged pre-trade (the Line-A thesis)");
}

// (7) makeRoutes 402-gates the route at $0.005 (payment middleware source of truth)
{
  const routes = makeRoutes("0x0000000000000000000000000000000000000001");
  const def = routes["GET /chain/simulate"];
  ok(!!def, "makeRoutes advertises GET /chain/simulate");
  eq(def.accepts.price, "$0.005", "402 challenge price is $0.005");
  ok(def.extensions && def.extensions, "has discovery extensions");
}

// (8) see_also cross-sell fires and never points back at self
{
  const sa = buildSeeAlso("/chain/simulate");
  ok(sa.length >= 1, "see_also returns at least one entry");
  ok(sa.every((e) => !e.resource.endsWith("/chain/simulate")), "see_also never points back at self");
}

console.log(`test_chain_simulate: ${pass} checks passed`);
