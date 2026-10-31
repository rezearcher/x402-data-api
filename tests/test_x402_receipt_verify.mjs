/**
 * Contract tests for the x402 POST-payment settlement proof
 * (src/index.ts: computeReceiptVerdict + decodeUsdcTransfers + x402ReceiptVerify
 * + the /x402/receipt-verify route registration).
 *
 *   node tests/test_x402_receipt_verify.mjs
 *
 * receipt-verify is the OTHER half of /x402/preflight: after a buyer pays an
 * x402 endpoint, it proves from Base mainnet that a USDC Transfer of >= the
 * advertised amount reached the endpoint's advertised payTo inside the given
 * tx. The verdict core is pure (no I/O) and is tested directly; the I/O wrapper
 * is tested with a stubbed global fetch (RPC receipt + live 402). Claims Law:
 * SETTLED proves settlement to the right address+amount, never off-chain
 * delivery (scope_note always present).
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const {
  computeReceiptVerdict,
  decodeUsdcTransfers,
  x402ReceiptVerify,
  makeRoutes,
  ROUTE_CATALOG,
} = await import("../src/index.ts");

let pass = 0;
function check(name, fn) { return Promise.resolve(fn()).then(() => { pass++; console.log(`ok - ${name}`); }); }

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PAYTO = "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10";
const PAYER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";
const TX = "0x65484d751686091cf5b7417b533372ab1e7548ca63825c746ffbd275fb4448ba";

const pad = (a) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
// Build a USDC Transfer log for `atomic` units from -> to.
function transferLog(from, to, atomic, token = USDC) {
  return { address: token, topics: [TRANSFER, pad(from), pad(to)], data: "0x" + BigInt(atomic).toString(16) };
}

// ---- pure core: computeReceiptVerdict -------------------------------------

// 1. Exact settlement to the advertised payTo for >= advertised -> SETTLED.
await check("exact USDC to payTo >= advertised -> SETTLED, settled true", () => {
  const transfers = [{ token: USDC, from: PAYER, to: PAYTO, amount_atomic: 4000, amount_usdc: "0.004" }];
  const r = computeReceiptVerdict("success", transfers, PAYTO, 4000);
  assert.strictEqual(r.verdict, "SETTLED");
  assert.strictEqual(r.settled, true);
  assert.strictEqual(r.matched.amount_atomic, 4000);
});

// 2. Payment short of the advertised amount -> UNDERPAID, not settled.
await check("USDC to payTo but below advertised -> UNDERPAID, settled false", () => {
  const transfers = [{ token: USDC, from: PAYER, to: PAYTO, amount_atomic: 1000, amount_usdc: "0.001" }];
  const r = computeReceiptVerdict("success", transfers, PAYTO, 4000);
  assert.strictEqual(r.verdict, "UNDERPAID");
  assert.strictEqual(r.settled, false);
});

// 3. USDC moved but to a different address -> WRONG_RECIPIENT.
await check("USDC moved to a different address -> WRONG_RECIPIENT, settled false", () => {
  const transfers = [{ token: USDC, from: PAYER, to: OTHER, amount_atomic: 4000, amount_usdc: "0.004" }];
  const r = computeReceiptVerdict("success", transfers, PAYTO, 4000);
  assert.strictEqual(r.verdict, "WRONG_RECIPIENT");
  assert.strictEqual(r.settled, false);
});

// 4. No USDC transfers at all -> NO_TRANSFER.
await check("no USDC transfers -> NO_TRANSFER, settled false", () => {
  const r = computeReceiptVerdict("success", [], PAYTO, 4000);
  assert.strictEqual(r.verdict, "NO_TRANSFER");
  assert.strictEqual(r.settled, false);
});

// 5. Reverted tx -> REVERTED regardless of logs.
await check("reverted tx -> REVERTED, settled false", () => {
  const r = computeReceiptVerdict("reverted", [{ token: USDC, from: PAYER, to: PAYTO, amount_atomic: 4000, amount_usdc: "0.004" }], PAYTO, 4000);
  assert.strictEqual(r.verdict, "REVERTED");
  assert.strictEqual(r.settled, false);
});

// 6. No receipt (null status) -> NOT_FOUND.
await check("null receipt -> NOT_FOUND, settled false", () => {
  const r = computeReceiptVerdict(null, [], PAYTO, 4000);
  assert.strictEqual(r.verdict, "NOT_FOUND");
  assert.strictEqual(r.settled, false);
});

// 7. No advertised payTo to bind against -> UNVERIFIED (never a false SETTLED).
await check("no advertised payTo -> UNVERIFIED, settled false", () => {
  const r = computeReceiptVerdict("success", [{ token: USDC, from: PAYER, to: PAYTO, amount_atomic: 4000, amount_usdc: "0.004" }], null, 4000);
  assert.strictEqual(r.verdict, "UNVERIFIED");
  assert.strictEqual(r.settled, false);
});

// 8. Recipient match but no advertised amount -> SETTLED (amount not checked).
await check("recipient match, no advertised amount -> SETTLED (amount not checked)", () => {
  const r = computeReceiptVerdict("success", [{ token: USDC, from: PAYER, to: PAYTO, amount_atomic: 4000, amount_usdc: "0.004" }], PAYTO, null);
  assert.strictEqual(r.verdict, "SETTLED");
  assert.strictEqual(r.settled, true);
  assert.ok(/not checked/i.test(r.note), "note discloses the amount was not verified (Claims Law)");
});

// 9. Split payment across two logs to the payTo sums to >= advertised -> SETTLED.
await check("split payment across logs sums to settled", () => {
  const transfers = [
    { token: USDC, from: PAYER, to: PAYTO, amount_atomic: 2500, amount_usdc: "0.0025" },
    { token: USDC, from: PAYER, to: PAYTO, amount_atomic: 1500, amount_usdc: "0.0015" },
  ];
  const r = computeReceiptVerdict("success", transfers, PAYTO, 4000);
  assert.strictEqual(r.verdict, "SETTLED");
  assert.strictEqual(r.matched.amount_atomic, 4000, "summed across logs");
});

// 10. Case-insensitive payTo match (checksummed advertised vs lowercase log).
await check("payTo match is case-insensitive", () => {
  const transfers = [{ token: USDC, from: PAYER, to: PAYTO.toLowerCase(), amount_atomic: 4000, amount_usdc: "0.004" }];
  const r = computeReceiptVerdict("success", transfers, "0x5765AE06A52DC7A0BB71C36A11DB512C7EA9ED10", 4000);
  assert.strictEqual(r.verdict, "SETTLED");
});

// ---- decoder: decodeUsdcTransfers -----------------------------------------

// 11. Decodes a real-shaped USDC Transfer log; ignores non-USDC + non-Transfer.
await check("decodeUsdcTransfers decodes USDC Transfer, ignores others", () => {
  const logs = [
    transferLog(PAYER, PAYTO, 4000),                                   // USDC transfer (keep)
    transferLog(PAYER, PAYTO, 9999, "0x4200000000000000000000000000000000000006"), // WETH (drop)
    { address: USDC, topics: ["0xdeadbeef", pad(PAYER), pad(PAYTO)], data: "0x1" },  // wrong topic0 (drop)
    { address: USDC, topics: [TRANSFER], data: "0x1" },               // too few topics (drop)
  ];
  const out = decodeUsdcTransfers(logs);
  assert.strictEqual(out.length, 1, `expected 1 USDC transfer, got ${out.length}`);
  assert.strictEqual(out[0].amount_atomic, 4000);
  assert.strictEqual(out[0].to.toLowerCase(), PAYTO.toLowerCase());
  assert.strictEqual(out[0].from.toLowerCase(), PAYER.toLowerCase());
});

// 12. Malformed logs are skipped, never thrown (degrade-open).
await check("decodeUsdcTransfers degrades open on malformed logs", () => {
  const out = decodeUsdcTransfers([null, {}, { address: USDC }, "junk"]);
  assert.ok(Array.isArray(out) && out.length === 0, "empty, no throw");
});

// ---- I/O wrapper: x402ReceiptVerify (stubbed fetch) -----------------------

const realFetch = globalThis.fetch;
function restore() { globalThis.fetch = realFetch; }

// 13. End-to-end: live 402 supplies payTo+amount, RPC returns a matching
//     receipt -> SETTLED, advertised.source=live-402, scope_note present.
await check("x402ReceiptVerify end-to-end -> SETTLED (live-402 payTo + matching receipt)", async () => {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    // RPC calls are POSTs with a JSON-RPC body.
    if (opts && opts.method === "POST" && typeof opts.body === "string" && opts.body.includes("eth_getTransactionReceipt")) {
      return { ok: true, status: 200, async json() {
        return { result: { status: "0x1", blockNumber: "0x3077a30", logs: [transferLog(PAYER, PAYTO, 4000)] } };
      } };
    }
    // Resource 402 challenge (live-402 payTo resolution).
    if (u.startsWith("https://seller.example")) {
      return { status: 402, ok: false, async text() { return JSON.stringify({ accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, payTo: PAYTO, maxAmountRequired: "4000" }] }); } };
    }
    return { ok: false, status: 404, async text() { return ""; }, async json() { return {}; } };
  };
  const r = await x402ReceiptVerify(TX, "https://seller.example/x402/data", null, null);
  restore();
  assert.strictEqual(r.verdict, "SETTLED", `verdict ${r.verdict}`);
  assert.strictEqual(r.settled, true);
  assert.strictEqual(r.advertised.source, "live-402");
  assert.strictEqual(r.advertised.payTo.toLowerCase(), PAYTO.toLowerCase());
  assert.strictEqual(r.tx_status, "success");
  assert.ok(typeof r.scope_note === "string" && r.scope_note.length > 0, "scope_note present (Claims Law)");
  assert.ok(!r.scope_note.toLowerCase().includes("guarantee deliver"), "never claims delivery guarantee");
});

// 14. Caller payto override works without any endpoint fetch; RPC null -> NOT_FOUND.
await check("x402ReceiptVerify caller payto + unknown tx -> NOT_FOUND", async () => {
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST" && typeof opts.body === "string" && opts.body.includes("eth_getTransactionReceipt")) {
      return { ok: true, status: 200, async json() { return { result: null }; } };
    }
    throw new Error("no endpoint fetch should happen when payto is supplied");
  };
  const r = await x402ReceiptVerify(TX, null, PAYTO, "0.004");
  restore();
  assert.strictEqual(r.verdict, "NOT_FOUND");
  assert.strictEqual(r.advertised.source, "caller");
  assert.strictEqual(r.advertised.payTo.toLowerCase(), PAYTO.toLowerCase());
});

// 15. RPC hard-error -> UNVERIFIED (NOT a false NOT_FOUND), settled false.
await check("x402ReceiptVerify RPC error -> UNVERIFIED (not falsely NOT_FOUND)", async () => {
  globalThis.fetch = async () => { throw new Error("all providers 429"); };
  const r = await x402ReceiptVerify(TX, null, PAYTO, "0.004");
  restore();
  assert.strictEqual(r.verdict, "UNVERIFIED");
  assert.strictEqual(r.settled, false);
  assert.ok(/NOT proven absent/i.test(r.note), "note distinguishes RPC-failure from genuine absence");
});

// ---- registration ----------------------------------------------------------

// 16. Registered on the 402 gate (makeRoutes) at the $0.004 floor price.
await check("registered on makeRoutes 402 gate at $0.004", () => {
  const routes = makeRoutes(PAYTO);
  const entry = routes["GET /x402/receipt-verify"];
  assert.ok(entry, "route present in makeRoutes");
  assert.strictEqual(entry.accepts.price, "$0.004", `price ${entry.accepts?.price}`);
  assert.strictEqual(entry.accepts.payTo, PAYTO);
});

// 17. Present in ROUTE_CATALOG with advertised amount matching the gate (no divergence).
await check("present in ROUTE_CATALOG at 4000 atomic (advertised == charged)", () => {
  const row = ROUTE_CATALOG.find((r) => r[0] === "/x402/receipt-verify");
  assert.ok(row, "catalog row present");
  assert.strictEqual(row[3], "4000", `atomic ${row[3]}`);
  assert.ok(row[4].length <= 500, `catalog desc <= 500 (was ${row[4].length})`);
});

console.log(`\n${pass} passed`);
