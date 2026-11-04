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
  receiptSettlementFingerprint,
  decodeAuthorizationUsed,
  computeAuthorizationProof,
  x402ReceiptVerify,
  jcsCanonicalize,
  settlementResultOf,
  buildSettlementAttestation,
  computeResourceBinding,
  resourceMatchesUrl,
  extractResourceUrl,
  computeFacilitatorConsistency,
  preflightFacilitatorConsistency,
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

// ---- dual-RPC cross-confirmation -------------------------------------------

// 15a. fingerprint: order-independent, status-sensitive.
await check("receiptSettlementFingerprint is order-independent and status-sensitive", () => {
  const t1 = { token: USDC, from: PAYER, to: PAYTO, amount_atomic: 4000, amount_usdc: "0.004" };
  const t2 = { token: USDC, from: PAYER, to: OTHER, amount_atomic: 1, amount_usdc: "0.000001" };
  assert.strictEqual(
    receiptSettlementFingerprint("success", [t1, t2]),
    receiptSettlementFingerprint("success", [t2, t1]),
    "same transfers in any order fingerprint identically",
  );
  assert.notStrictEqual(
    receiptSettlementFingerprint("success", [t1]),
    receiptSettlementFingerprint("reverted", [t1]),
    "status flip changes the fingerprint",
  );
});

// 15b. Two independent providers AGREE -> SETTLED, confirmation=dual-confirmed,
//      two rpc_sources reported.
await check("x402ReceiptVerify dual providers agree -> SETTLED dual-confirmed", async () => {
  let rpcCall = 0;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST" && String(opts.body).includes("eth_getTransactionReceipt")) {
      rpcCall++;
      return { ok: true, status: 200, async json() { return { result: { status: "0x1", blockNumber: "0x3077a30", logs: [transferLog(PAYER, PAYTO, 4000)] } }; } };
    }
    throw new Error("no endpoint fetch when payto supplied");
  };
  const r = await x402ReceiptVerify(TX, null, PAYTO, "0.004");
  restore();
  assert.strictEqual(r.verdict, "SETTLED", `verdict ${r.verdict}`);
  assert.strictEqual(r.confirmation, "dual-confirmed", `confirmation ${r.confirmation}`);
  assert.strictEqual(r.rpc_sources.length, 2, "two independent RPC sources listed");
  assert.ok(rpcCall >= 2, "queried at least two providers");
});

// 15c. Two independent providers DISAGREE -> UNVERIFIED, fail CLOSED
//      (confirmation=rpc-disagreement). This is the integrity guarantee.
await check("x402ReceiptVerify dual providers disagree -> UNVERIFIED (fail closed)", async () => {
  let rpcCall = 0;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST" && String(opts.body).includes("eth_getTransactionReceipt")) {
      rpcCall++;
      // provider A sees a USDC settlement to payTo; provider B sees none.
      if (rpcCall === 1) return { ok: true, status: 200, async json() { return { result: { status: "0x1", blockNumber: "0x3077a30", logs: [transferLog(PAYER, PAYTO, 4000)] } }; } };
      return { ok: true, status: 200, async json() { return { result: { status: "0x1", blockNumber: "0x3077a30", logs: [] } }; } };
    }
    throw new Error("no endpoint fetch when payto supplied");
  };
  const r = await x402ReceiptVerify(TX, null, PAYTO, "0.004");
  restore();
  assert.strictEqual(r.verdict, "UNVERIFIED", `verdict ${r.verdict}`);
  assert.strictEqual(r.settled, false);
  assert.strictEqual(r.confirmation, "rpc-disagreement", `confirmation ${r.confirmation}`);
  assert.ok(/fail/i.test(r.note) && /disagree|different/i.test(r.note), "note explains the fail-closed");
});

// 15d. Only ONE provider reachable -> degrade open but DISCLOSE
//      (confirmation=single-source), still returns the verdict.
await check("x402ReceiptVerify one provider down -> single-source (degrade-open, disclosed)", async () => {
  let rpcCall = 0;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST" && String(opts.body).includes("eth_getTransactionReceipt")) {
      rpcCall++;
      if (rpcCall === 1) throw new Error("provider A 429");
      return { ok: true, status: 200, async json() { return { result: { status: "0x1", blockNumber: "0x3077a30", logs: [transferLog(PAYER, PAYTO, 4000)] } }; } };
    }
    throw new Error("no endpoint fetch when payto supplied");
  };
  const r = await x402ReceiptVerify(TX, null, PAYTO, "0.004");
  restore();
  assert.strictEqual(r.verdict, "SETTLED", `verdict ${r.verdict}`);
  assert.strictEqual(r.confirmation, "single-source", `confirmation ${r.confirmation}`);
  assert.strictEqual(r.rpc_sources.length, 1, "one source listed when only one reachable");
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

await check("non-exact scheme (upto): lower settled amount is SETTLED, not UNDERPAID", () => {
  const t = [{ token: USDC, from: PAYER, to: PAYTO, amount_atomic: 2000, amount_usdc: "0.002" }];
  const capped = computeReceiptVerdict("success", t, PAYTO, 10000, 6, true);
  assert.strictEqual(capped.verdict, "SETTLED");
  assert.strictEqual(capped.settled, true);
  const exact = computeReceiptVerdict("success", t, PAYTO, 10000, 6, false);
  assert.strictEqual(exact.verdict, "UNDERPAID");
});

// ---- EIP-3009 authorization proof (4-check standard, check #2) -------------

const AUTH_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const NONCE = "0x" + "ab".repeat(32);
function authUsedLog(authorizer, nonce = NONCE, token = USDC) {
  return { address: token, topics: [AUTH_USED, pad(authorizer), nonce] };
}
// authorizationState(address,bytes32) eth_call result: true/false ABI-encoded.
function stateWord(b) { return "0x" + (b ? "1" : "0").padStart(64, "0"); }

// 18. decodeAuthorizationUsed: decodes USDC AuthorizationUsed, ignores others.
await check("decodeAuthorizationUsed decodes authorizer+nonce, ignores non-USDC/non-event", () => {
  const out = decodeAuthorizationUsed([
    authUsedLog(PAYER),
    authUsedLog(OTHER, NONCE, "0x4200000000000000000000000000000000000006"), // non-USDC (drop)
    { address: USDC, topics: ["0xdeadbeef", pad(PAYER), NONCE] },               // wrong topic (drop)
    transferLog(PAYER, PAYTO, 4000),                                           // Transfer (drop)
  ]);
  assert.strictEqual(out.length, 1, `expected 1 auth event, got ${out.length}`);
  assert.strictEqual(out[0].authorizer.toLowerCase(), PAYER.toLowerCase());
  assert.strictEqual(out[0].nonce.toLowerCase(), NONCE.toLowerCase());
});

// 19. computeAuthorizationProof: no events -> not-eip3009 (direct transfer).
await check("computeAuthorizationProof no events -> not-eip3009", () => {
  const p = computeAuthorizationProof([], PAYER, null);
  assert.strictEqual(p.status, "not-eip3009");
  assert.strictEqual(p.events, 0);
});

// 20. event + state true -> consumed (the gold-standard bind).
await check("computeAuthorizationProof event + state consumed -> consumed", () => {
  const p = computeAuthorizationProof([{ authorizer: PAYER, nonce: NONCE }], PAYER, true, "dual-confirmed");
  assert.strictEqual(p.status, "consumed");
  assert.strictEqual(p.authorizer.toLowerCase(), PAYER.toLowerCase());
  assert.strictEqual(p.confirmation, "dual-confirmed");
});

// 21. event present but state NOT consumed (dual-confirmed) -> state-mismatch (forgery signal).
await check("computeAuthorizationProof event + state NOT consumed -> state-mismatch", () => {
  const p = computeAuthorizationProof([{ authorizer: PAYER, nonce: NONCE }], PAYER, false, "dual-confirmed");
  assert.strictEqual(p.status, "state-mismatch");
  assert.ok(/FORGERY/i.test(p.note), "note flags the forgery signal");
});

// 22. event present, state unreadable -> unverified (degrade-open).
await check("computeAuthorizationProof event + unreadable state -> unverified", () => {
  const p = computeAuthorizationProof([{ authorizer: PAYER, nonce: NONCE }], PAYER, null, "single-source");
  assert.strictEqual(p.status, "unverified");
});

// 23. providers disagree on authorizationState -> unverified, not asserted.
await check("computeAuthorizationProof rpc-disagreement -> unverified", () => {
  const p = computeAuthorizationProof([{ authorizer: PAYER, nonce: NONCE }], PAYER, null, "rpc-disagreement");
  assert.strictEqual(p.status, "unverified");
  assert.strictEqual(p.confirmation, "rpc-disagreement");
});

// 24. E2E: receipt carries a matching Transfer AND an AuthorizationUsed log, and
//     authorizationState reads consumed on both providers -> SETTLED + consumed.
await check("x402ReceiptVerify EIP-3009 settlement -> SETTLED + authorization consumed", async () => {
  globalThis.fetch = async (url, opts) => {
    const body = String(opts && opts.body);
    if (opts && opts.method === "POST" && body.includes("eth_getTransactionReceipt")) {
      return { ok: true, status: 200, async json() { return { result: { status: "0x1", blockNumber: "0x3077a30", logs: [transferLog(PAYER, PAYTO, 4000), authUsedLog(PAYER)] } }; } };
    }
    if (opts && opts.method === "POST" && body.includes("eth_call")) {
      return { ok: true, status: 200, async json() { return { result: stateWord(true) }; } };
    }
    throw new Error("no endpoint fetch when payto supplied");
  };
  const r = await x402ReceiptVerify(TX, null, PAYTO, "0.004");
  restore();
  assert.strictEqual(r.verdict, "SETTLED", `verdict ${r.verdict}`);
  assert.strictEqual(r.authorization.status, "consumed", `auth ${r.authorization.status}`);
  assert.strictEqual(r.authorization.authorizer.toLowerCase(), PAYER.toLowerCase());
  assert.ok(/authorization consumed/i.test(r.note), "note surfaces the authorization bind");
});

// 25. E2E forgery: a matching Transfer to payTo + an AuthorizationUsed log, but
//     authorizationState is NOT consumed on both providers -> the amount match
//     would have said SETTLED; we fail CLOSED to UNVERIFIED. This is the forgery
//     (unrelated/replayed transfer to the same payTo) the amount-match misses.
await check("x402ReceiptVerify forged/replayed auth (state not consumed) -> UNVERIFIED fail-closed", async () => {
  globalThis.fetch = async (url, opts) => {
    const body = String(opts && opts.body);
    if (opts && opts.method === "POST" && body.includes("eth_getTransactionReceipt")) {
      return { ok: true, status: 200, async json() { return { result: { status: "0x1", blockNumber: "0x3077a30", logs: [transferLog(PAYER, PAYTO, 4000), authUsedLog(PAYER)] } }; } };
    }
    if (opts && opts.method === "POST" && body.includes("eth_call")) {
      return { ok: true, status: 200, async json() { return { result: stateWord(false) }; } };
    }
    throw new Error("no endpoint fetch when payto supplied");
  };
  const r = await x402ReceiptVerify(TX, null, PAYTO, "0.004");
  restore();
  assert.strictEqual(r.verdict, "UNVERIFIED", `verdict ${r.verdict}`);
  assert.strictEqual(r.settled, false);
  assert.strictEqual(r.authorization.status, "state-mismatch", `auth ${r.authorization.status}`);
  assert.ok(/Failing closed/i.test(r.note), "note explains the fail-closed");
});

// 26. E2E: direct ERC-20 transfer (no AuthorizationUsed) -> SETTLED, authorization
//     not-eip3009, and NO eth_call is made (authorizationState not queried).
await check("x402ReceiptVerify direct transfer (no auth event) -> SETTLED + not-eip3009, no eth_call", async () => {
  let ethCalls = 0;
  globalThis.fetch = async (url, opts) => {
    const body = String(opts && opts.body);
    if (opts && opts.method === "POST" && body.includes("eth_getTransactionReceipt")) {
      return { ok: true, status: 200, async json() { return { result: { status: "0x1", blockNumber: "0x3077a30", logs: [transferLog(PAYER, PAYTO, 4000)] } }; } };
    }
    if (opts && opts.method === "POST" && body.includes("eth_call")) { ethCalls++; return { ok: true, status: 200, async json() { return { result: stateWord(true) }; } }; }
    throw new Error("no endpoint fetch when payto supplied");
  };
  const r = await x402ReceiptVerify(TX, null, PAYTO, "0.004");
  restore();
  assert.strictEqual(r.verdict, "SETTLED", `verdict ${r.verdict}`);
  assert.strictEqual(r.authorization.status, "not-eip3009", `auth ${r.authorization.status}`);
  assert.strictEqual(ethCalls, 0, "no authorizationState eth_call when there is no AuthorizationUsed event");
});

// ---- settlement attestation (draft-hopley JCS/RFC8785) --------------------

import crypto from "node:crypto";
const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// 27. JCS canonicalization: keys sorted by code unit, no whitespace, integers plain.
await check("jcsCanonicalize sorts keys by code unit and emits compact form", () => {
  const out = jcsCanonicalize({ b: 1, a: "x", c: [3, 2], nested: { z: true, y: null } });
  assert.strictEqual(out, '{"a":"x","b":1,"c":[3,2],"nested":{"y":null,"z":true}}', out);
});

// 28. JCS is deterministic regardless of insertion order.
await check("jcsCanonicalize is insertion-order independent", () => {
  const a = jcsCanonicalize({ settlement_result: "SETTLED", canon_version: "jcs-rfc8785-v1", amount: 4000 });
  const b = jcsCanonicalize({ amount: 4000, canon_version: "jcs-rfc8785-v1", settlement_result: "SETTLED" });
  assert.strictEqual(a, b, "same object, any key order -> identical canonical string");
});

// 29. JCS refuses non-integer numbers (a float would break the hash silently).
await check("jcsCanonicalize throws on a non-integer number", () => {
  assert.throws(() => jcsCanonicalize({ x: 1.5 }), /integer/i);
});

// 30. settlementResultOf maps verdicts to the draft enum (or null for non-settlements).
await check("settlementResultOf maps verdicts correctly", () => {
  assert.strictEqual(settlementResultOf({ verdict: "SETTLED", settled: true, confirmation: "dual-confirmed" }), "SETTLED");
  assert.strictEqual(settlementResultOf({ verdict: "SETTLED", settled: true, confirmation: "single-source" }), "PENDING_FINALITY");
  assert.strictEqual(settlementResultOf({ verdict: "REVERTED", settled: false, confirmation: "single-source" }), "REVERSED");
  for (const v of ["UNDERPAID", "WRONG_RECIPIENT", "NO_TRANSFER", "NOT_FOUND", "UNVERIFIED"]) {
    assert.strictEqual(settlementResultOf({ verdict: v, settled: false, confirmation: "dual-confirmed" }), null, `${v} is not attestable`);
  }
});

// 31. buildSettlementAttestation produces a conformant, self-verifying envelope.
await check("buildSettlementAttestation emits a verifiable draft-hopley envelope", async () => {
  const r = {
    tx: "0x" + "ab".repeat(32),
    verdict: "SETTLED", settled: true, confirmation: "dual-confirmed",
    advertised: { payTo: PAYTO, amount_atomic: 4000, amount_usdc: "0.004", source: "live-402" },
    matched_transfer: { token: USDC, from: PAYER, to: PAYTO, amount_atomic: 4000, amount_usdc: "0.004" },
    authorization: { status: "consumed", authorizer: PAYER, nonce: "0x" + "cd".repeat(32), events: 1, confirmation: "dual-confirmed", note: "" },
  };
  const att = await buildSettlementAttestation(r, 1730000000000);
  assert.ok(att, "attestation built for SETTLED");
  assert.strictEqual(att.settlement_result, "SETTLED");
  assert.strictEqual(att.canon_version, "jcs-rfc8785-v1");
  assert.strictEqual(att.settlement_chain, "ethereum:8453");
  assert.strictEqual(att.settlement_amount.amount_minor, "4000");
  assert.strictEqual(att.settlement_amount.asset_id, "USDC.6");
  assert.ok(/^sha256:[0-9a-f]{64}$/.test(att.settled_payment_ref), "settled_payment_ref is sha256:<hex64>");
  assert.ok(/^sha256:[0-9a-f]{64}$/.test(att.content_hash), "content_hash is sha256:<hex64>");
  assert.deepStrictEqual(att.jurisdiction_flags, []);
  // Independently re-derive content_hash exactly as a consumer (ERC-8004/Vouch) would:
  // drop content_hash, JCS-canonicalize, SHA-256.
  const { content_hash, ...envelope } = att;
  const recomputed = "sha256:" + sha256hex(jcsCanonicalize(envelope));
  assert.strictEqual(recomputed, content_hash, "content_hash reproduces from JCS(envelope) — standards-conformant");
});

// 32. Non-settlement verdicts produce NO attestation (never a false attestation).
await check("buildSettlementAttestation returns null for a non-settlement", async () => {
  const att = await buildSettlementAttestation({ verdict: "UNVERIFIED", settled: false, confirmation: "rpc-disagreement", tx: "0x" + "00".repeat(32), advertised: { payTo: null, amount_atomic: null }, matched_transfer: null, authorization: { nonce: null } }, 1730000000000);
  assert.strictEqual(att, null);
});

// ── Cross-resource substitution verdict (arXiv:2605.30998, 4th flaw class) ──
// resourceMatchesUrl normalization.
await check("resourceMatchesUrl: exact match ignores query/fragment/trailing slash", () => {
  assert.strictEqual(resourceMatchesUrl("https://seller.example/x402/data", "https://seller.example/x402/data"), true);
  assert.strictEqual(resourceMatchesUrl("https://seller.example/x402/data/", "https://seller.example/x402/data"), true);
  assert.strictEqual(resourceMatchesUrl("https://seller.example/x402/data?x=1#f", "https://seller.example/x402/data"), true);
  assert.strictEqual(resourceMatchesUrl("https://SELLER.example/x402/data", "https://seller.example/x402/data"), true);
});
await check("resourceMatchesUrl: relative resource resolves against the paid url", () => {
  assert.strictEqual(resourceMatchesUrl("/x402/data", "https://seller.example/x402/data"), true);
  assert.strictEqual(resourceMatchesUrl("/x402/other", "https://seller.example/x402/data"), false);
});
await check("resourceMatchesUrl: different path or host => false", () => {
  assert.strictEqual(resourceMatchesUrl("https://seller.example/x402/expensive", "https://seller.example/x402/cheap"), false);
  assert.strictEqual(resourceMatchesUrl("https://evil.example/x402/data", "https://seller.example/x402/data"), false);
});
await check("resourceMatchesUrl: unparseable side => null", () => {
  assert.strictEqual(resourceMatchesUrl(null, "https://seller.example/x402/data"), null);
  assert.strictEqual(resourceMatchesUrl("not a url", null), null);
});

// extractResourceUrl handles both the string and {url,...} object forms.
await check("extractResourceUrl: string, object{url}, and junk", () => {
  assert.strictEqual(extractResourceUrl("https://seller.example/x402/data"), "https://seller.example/x402/data");
  assert.strictEqual(extractResourceUrl({ url: "https://seller.example/x402/data", description: "x" }), "https://seller.example/x402/data");
  assert.strictEqual(extractResourceUrl("  "), null);
  assert.strictEqual(extractResourceUrl({ description: "no url" }), null);
  assert.strictEqual(extractResourceUrl(null), null);
  assert.strictEqual(extractResourceUrl(42), null);
});

// computeResourceBinding verdicts.
await check("computeResourceBinding: DECLARED when declared resource matches the paid url", () => {
  const rb = computeResourceBinding("https://seller.example/x402/data", true, "https://seller.example/x402/data", "exact", true);
  assert.strictEqual(rb.verdict, "DECLARED");
  assert.strictEqual(rb.matches, true);
  assert.strictEqual(rb.scheme_binds_resource, false, "exact scheme never cryptographically binds the resource");
  assert.strictEqual(rb.nonce_consumed, true);
});
await check("computeResourceBinding: RESOURCE_MISMATCH fails closed when the 402 names a different resource (cross-resource substitution)", () => {
  const rb = computeResourceBinding("https://seller.example/x402/expensive", true, "https://seller.example/x402/cheap", "exact", true);
  assert.strictEqual(rb.verdict, "RESOURCE_MISMATCH");
  assert.strictEqual(rb.matches, false);
  assert.ok(/different resource/i.test(rb.note));
});
await check("computeResourceBinding: SUBSTITUTABLE when a 402 is read but declares no resource field", () => {
  const rb = computeResourceBinding("https://seller.example/x402/data", true, null, "exact", null);
  assert.strictEqual(rb.verdict, "SUBSTITUTABLE");
  assert.ok(/no .?resource.? field|ANY x402 resource/i.test(rb.note));
});
await check("computeResourceBinding: UNVERIFIED when no url supplied", () => {
  const rb = computeResourceBinding(null, false, null, null, null);
  assert.strictEqual(rb.verdict, "UNVERIFIED");
});
await check("computeResourceBinding: UNVERIFIED when the live 402 could not be read (payTo-only path)", () => {
  const rb = computeResourceBinding("https://seller.example/x402/data", false, null, null, true);
  assert.strictEqual(rb.verdict, "UNVERIFIED");
  assert.ok(/could not read a live 402/i.test(rb.note));
});
await check("computeResourceBinding: DECLARED notes unconsumed-nonce transplant exposure", () => {
  const rb = computeResourceBinding("https://seller.example/x402/data", true, "https://seller.example/x402/data", "exact", false);
  assert.strictEqual(rb.verdict, "DECLARED");
  assert.ok(/transplantable|not confirmed consumed/i.test(rb.note));
});

// ---- facilitator verify/settle consistency (arXiv:2607.19545 class-1) -------

const matchedT = (atomic) => ({ token: USDC, from: PAYER, to: PAYTO, amount_atomic: atomic, amount_usdc: (atomic / 1e6).toFixed(6) });

await check("facilitator_consistency: settled == advertised -> CONSISTENT, delta 0, dual-confirmed", () => {
  const fc = computeFacilitatorConsistency("SETTLED", matchedT(4000), 4000, false, "dual-confirmed");
  assert.strictEqual(fc.verdict, "CONSISTENT");
  assert.strictEqual(fc.phase, "post-payment");
  assert.strictEqual(fc.delta_atomic, 0);
  assert.strictEqual(fc.direction, "match");
  assert.strictEqual(fc.settled_atomic, 4000);
  assert.ok(/verify.*chain agree|no verify\/settle divergence/i.test(fc.note));
});
await check("facilitator_consistency: chain moved LESS than advertised (free-shopping) -> SETTLE_DIVERGENCE under_settle", () => {
  // Vector-9 parser differential: /verify approved 1000 ('1e3'->BigInt), chain moved 1 (parseInt).
  const fc = computeFacilitatorConsistency("UNDERPAID", matchedT(1), 1000, false, "dual-confirmed");
  assert.strictEqual(fc.verdict, "SETTLE_DIVERGENCE");
  assert.strictEqual(fc.direction, "under_settle");
  assert.strictEqual(fc.delta_atomic, -999);
  assert.ok(/free-shopping|DIVERGE/i.test(fc.note));
  assert.ok(/arXiv:2607\.19545/.test(fc.attack_class));
});
await check("facilitator_consistency: chain moved MORE than advertised -> SETTLE_DIVERGENCE over_settle", () => {
  const fc = computeFacilitatorConsistency("SETTLED", matchedT(9000), 4000, false, "dual-confirmed");
  assert.strictEqual(fc.verdict, "SETTLE_DIVERGENCE");
  assert.strictEqual(fc.direction, "over_settle");
  assert.strictEqual(fc.delta_atomic, 5000);
});
await check("facilitator_consistency: within 1% tolerance -> CONSISTENT (no false divergence on rounding)", () => {
  const fc = computeFacilitatorConsistency("SETTLED", matchedT(10005), 10000, false, "dual-confirmed");
  assert.strictEqual(fc.verdict, "CONSISTENT");
  assert.strictEqual(fc.direction, "match");
});
await check("facilitator_consistency: non-exact (cap) scheme -> UNVERIFIED (lower settle is legitimate)", () => {
  const fc = computeFacilitatorConsistency("SETTLED", matchedT(1), 1000, true, "dual-confirmed");
  assert.strictEqual(fc.verdict, "UNVERIFIED");
  assert.ok(/not 'exact'|ceiling/i.test(fc.note));
});
await check("facilitator_consistency: no advertised amount -> UNVERIFIED (nothing to compare)", () => {
  const fc = computeFacilitatorConsistency("SETTLED", matchedT(4000), null, false, "dual-confirmed");
  assert.strictEqual(fc.verdict, "UNVERIFIED");
  assert.ok(/no advertised amount/i.test(fc.note));
});
await check("facilitator_consistency: rpc-disagreement -> UNVERIFIED fail-closed (never asserts consistency on untrusted data)", () => {
  const fc = computeFacilitatorConsistency("UNVERIFIED", null, 4000, false, "rpc-disagreement");
  assert.strictEqual(fc.verdict, "UNVERIFIED");
  assert.ok(/disagreed|failing closed/i.test(fc.note));
});
await check("facilitator_consistency: WRONG_RECIPIENT/NO_TRANSFER/REVERTED/NOT_FOUND -> UNVERIFIED (no settled amount to payTo)", () => {
  for (const v of ["WRONG_RECIPIENT", "NO_TRANSFER", "REVERTED", "NOT_FOUND"]) {
    const fc = computeFacilitatorConsistency(v, null, 4000, false, "dual-confirmed");
    assert.strictEqual(fc.verdict, "UNVERIFIED", `${v} -> UNVERIFIED`);
  }
});
await check("preflightFacilitatorConsistency: always UNVERIFIED pre-pay, phase pre-payment, cross-links receipt-verify", () => {
  const fc = preflightFacilitatorConsistency({ verdict: "MATCH", advertised_atomic: 1000 });
  assert.strictEqual(fc.verdict, "UNVERIFIED");
  assert.strictEqual(fc.phase, "pre-payment");
  assert.strictEqual(fc.settled_atomic, null);
  assert.ok(/receipt-verify/i.test(fc.note));
  assert.ok(/price_accuracy=MATCH/.test(fc.note));
});
await check("preflightFacilitatorConsistency: OVERCHARGE surfaces the pre-pay advertised-vs-wire cousin", () => {
  const fc = preflightFacilitatorConsistency({ verdict: "OVERCHARGE", advertised_atomic: 1000 });
  assert.strictEqual(fc.verdict, "UNVERIFIED");
  assert.ok(/price_accuracy=OVERCHARGE/.test(fc.note));
});
await check("preflightFacilitatorConsistency: no price_accuracy -> bare post-pay pointer (degrade-open)", () => {
  const fc = preflightFacilitatorConsistency(undefined);
  assert.strictEqual(fc.verdict, "UNVERIFIED");
  assert.strictEqual(fc.advertised_atomic, null);
  assert.ok(/only observable AFTER payment/i.test(fc.note));
});

console.log(`\n${pass} passed`);
