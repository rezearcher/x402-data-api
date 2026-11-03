import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reconcileSettlement,
  decodeUsdcTransfers,
  usdcToAtomic,
  atomicToUsdcStr,
  readSettlementReceipt,
  wrapFetchWithVerifiedPayment,
  X402SettlementError,
  SETTLEMENT_HEADER,
  USDC_BASE,
  USDC_TRANSFER_TOPIC,
} from "../dist/index.js";
import { encodePaymentResponseHeader } from "@x402/core/http";
import { x402Client } from "@x402/fetch";

const PAYTO = "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10";
const BUYER = "0x1111111111111111111111111111111111111111";

function pad(addr) {
  return "0x" + "0".repeat(24) + addr.slice(2).toLowerCase();
}
function usdcLog(from, to, atomic) {
  return {
    address: USDC_BASE,
    topics: [USDC_TRANSFER_TOPIC, pad(from), pad(to)],
    data: "0x" + atomic.toString(16).padStart(64, "0"),
  };
}

// ---- pure reconcile ----
test("SETTLED when correct payTo gets >= advertised amount", () => {
  const transfers = decodeUsdcTransfers([usdcLog(BUYER, PAYTO, 4000)]);
  const r = reconcileSettlement("success", transfers, PAYTO, 4000);
  assert.equal(r.verdict, "SETTLED");
  assert.equal(r.settled, true);
  assert.equal(r.matched.amount_atomic, 4000);
});

test("UNDERPAID when payTo gets less than advertised", () => {
  const transfers = decodeUsdcTransfers([usdcLog(BUYER, PAYTO, 1000)]);
  const r = reconcileSettlement("success", transfers, PAYTO, 4000);
  assert.equal(r.verdict, "UNDERPAID");
  assert.equal(r.settled, false);
});

test("WRONG_RECIPIENT when USDC moved but not to payTo", () => {
  const other = "0x2222222222222222222222222222222222222222";
  const transfers = decodeUsdcTransfers([usdcLog(BUYER, other, 4000)]);
  const r = reconcileSettlement("success", transfers, PAYTO, 4000);
  assert.equal(r.verdict, "WRONG_RECIPIENT");
});

test("NO_TRANSFER when no USDC transfer at all", () => {
  const r = reconcileSettlement("success", [], PAYTO, 4000);
  assert.equal(r.verdict, "NO_TRANSFER");
});

test("REVERTED tx never settles", () => {
  const transfers = decodeUsdcTransfers([usdcLog(BUYER, PAYTO, 4000)]);
  const r = reconcileSettlement("reverted", transfers, PAYTO, 4000);
  assert.equal(r.verdict, "REVERTED");
});

test("NOT_FOUND when no receipt", () => {
  assert.equal(reconcileSettlement(null, [], PAYTO, 4000).verdict, "NOT_FOUND");
});

test("UNVERIFIED when no advertised payTo to bind against", () => {
  const transfers = decodeUsdcTransfers([usdcLog(BUYER, PAYTO, 4000)]);
  assert.equal(reconcileSettlement("success", transfers, null, 4000).verdict, "UNVERIFIED");
});

test("non-exact scheme treats advertised amount as a ceiling (not UNDERPAID)", () => {
  const transfers = decodeUsdcTransfers([usdcLog(BUYER, PAYTO, 1000)]);
  const r = reconcileSettlement("success", transfers, PAYTO, 4000, undefined, true);
  assert.equal(r.verdict, "SETTLED");
});

test("usdcToAtomic / atomicToUsdcStr round-trip", () => {
  assert.equal(usdcToAtomic("0.004"), 4000);
  assert.equal(atomicToUsdcStr(4000), "0.004");
  assert.equal(usdcToAtomic(null), null);
});

// ---- chain read: cross-confirmation ----
function rpcMock(receiptByCall) {
  // receiptByCall: array of receipt objects (or null), one per RPC url, in order
  let i = 0;
  return async (_url, _init) => {
    const receipt = receiptByCall[i++ % receiptByCall.length];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: receipt }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

test("readSettlementReceipt dual-confirmed when both RPCs agree", async () => {
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  const read = await readSettlementReceipt("0xdead", { fetchImpl: rpcMock([receipt, receipt]) });
  assert.equal(read.confirmation, "dual-confirmed");
  assert.equal(read.status, "success");
  assert.equal(read.transfers.length, 1);
});

test("readSettlementReceipt fails closed on RPC disagreement", async () => {
  const good = { status: "0x1", blockNumber: "0x1", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  const bad = { status: "0x1", blockNumber: "0x1", logs: [usdcLog(BUYER, PAYTO, 9999)] };
  const read = await readSettlementReceipt("0xdead", { fetchImpl: rpcMock([good, bad]) });
  assert.equal(read.confirmation, "rpc-disagreement");
  assert.equal(read.status, null);
});

// ---- end-to-end wrapper ----
function makeSettledResponse(tx, { payer = BUYER, network = "eip155:8453", amount = "4000" } = {}) {
  const header = encodePaymentResponseHeader({ success: true, transaction: tx, network, payer, amount });
  return new Response(JSON.stringify({ ok: true, data: "paid-content" }), {
    status: 200,
    headers: { "content-type": "application/json", "payment-response": header },
  });
}

test("wrapper attaches SETTLED verdict from on-chain reconcile", async () => {
  const tx = "0x3e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1a0";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  // baseFetch: the "network" the payer talks to — returns a settled 200.
  const baseFetch = async () => makeSettledResponse(tx);
  // fetchImpl: probe (402 with advertised payTo) + RPC receipt reads.
  const fetchImpl = async (url, init) => {
    if (init && init.method === "POST") {
      // RPC call
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: receipt }), { status: 200 });
    }
    // unpaid probe -> 402 advertising payTo + 4000
    return new Response(
      JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000", network: "eip155:8453" }] }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
  };
  let captured = null;
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), {
    fetchImpl,
    onSettlement: (s) => (captured = s),
  });
  const res = await vf("https://seller.example/x402/data");
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.verdict, "SETTLED");
  assert.equal(verdict.tx, tx);
  assert.equal(verdict.confirmation, "dual-confirmed");
  assert.equal(captured.verdict, "SETTLED");
  // body still readable (degrade-open — we never consume it)
  const body = await res.json();
  assert.equal(body.data, "paid-content");
});

test("wrapper throws on WRONG_RECIPIENT when onMismatch=throw", async () => {
  const tx = "0xabc0000000000000000000000000000000000000000000000000000000000001";
  const other = "0x2222222222222222222222222222222222222222";
  const receipt = { status: "0x1", blockNumber: "0x1", logs: [usdcLog(BUYER, other, 4000)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (url, init) => {
    if (init && init.method === "POST") return new Response(JSON.stringify({ result: receipt }), { status: 200 });
    return new Response(JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }), { status: 402 });
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl, onMismatch: "throw" });
  await assert.rejects(() => vf("https://seller.example/x402/data"), (e) => {
    assert.ok(e instanceof X402SettlementError);
    assert.equal(e.settlement.verdict, "WRONG_RECIPIENT");
    return true;
  });
});

test("reconcile:off is a pure pass-through payer", async () => {
  const baseFetch = async () => new Response("hi", { status: 200 });
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { reconcile: "off" });
  const res = await vf("https://seller.example/x402/data");
  assert.equal(res.headers.get(SETTLEMENT_HEADER), null);
  assert.equal(await res.text(), "hi");
});
