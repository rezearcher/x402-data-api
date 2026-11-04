import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reconcileSettlement,
  decodeUsdcTransfers,
  decodeAuthorizationUsed,
  computeAuthorizationProof,
  computePayloadBind,
  decodeSignedAuthorization,
  readBlockTimestamp,
  usdcToAtomic,
  atomicToUsdcStr,
  readSettlementReceipt,
  confirmAuthorizationState,
  wrapFetchWithVerifiedPayment,
  X402SettlementError,
  SETTLEMENT_HEADER,
  USDC_BASE,
  USDC_TRANSFER_TOPIC,
  USDC_AUTH_USED_TOPIC,
} from "../dist/index.js";
import { encodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { x402Client } from "@x402/fetch";

const PAYTO = "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10";
const BUYER = "0x1111111111111111111111111111111111111111";
const NONCE = "0x" + "ab".repeat(32);

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
function authUsedLog(authorizer, nonce = NONCE) {
  return {
    address: USDC_BASE,
    topics: [USDC_AUTH_USED_TOPIC, pad(authorizer), nonce],
    data: "0x",
  };
}
// classify an RPC POST body as a receipt read or an authorizationState eth_call
function rpcMethod(init) {
  try {
    const b = JSON.parse(init.body);
    return b.method;
  } catch {
    return null;
  }
}
const CONSUMED = "0x" + "0".repeat(63) + "1";
const NOT_CONSUMED = "0x" + "0".repeat(64);

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

// ---- EIP-3009 authorization proof (4-check #2) ----
test("decodeAuthorizationUsed pulls authorizer + nonce from the receipt log", () => {
  const ev = decodeAuthorizationUsed([usdcLog(BUYER, PAYTO, 4000), authUsedLog(BUYER)]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].authorizer, BUYER.toLowerCase());
  assert.equal(ev[0].nonce, NONCE.toLowerCase());
});

test("computeAuthorizationProof: not-eip3009 when no AuthorizationUsed event", () => {
  const p = computeAuthorizationProof([], BUYER, null);
  assert.equal(p.status, "not-eip3009");
});

test("computeAuthorizationProof: consumed when state true (dual-confirmed)", () => {
  const ev = decodeAuthorizationUsed([authUsedLog(BUYER)]);
  const p = computeAuthorizationProof(ev, BUYER, true, "dual-confirmed");
  assert.equal(p.status, "consumed");
  assert.equal(p.authorizer, BUYER.toLowerCase());
});

test("computeAuthorizationProof: state-mismatch (FORGERY) when log present but state false", () => {
  const ev = decodeAuthorizationUsed([authUsedLog(BUYER)]);
  const p = computeAuthorizationProof(ev, BUYER, false, "dual-confirmed");
  assert.equal(p.status, "state-mismatch");
});

test("computeAuthorizationProof: unverified on rpc-disagreement", () => {
  const ev = decodeAuthorizationUsed([authUsedLog(BUYER)]);
  const p = computeAuthorizationProof(ev, BUYER, null, "rpc-disagreement");
  assert.equal(p.status, "unverified");
});

test("confirmAuthorizationState dual-confirmed consumed", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ result: CONSUMED }), { status: 200 });
  const st = await confirmAuthorizationState(BUYER, NONCE, { fetchImpl });
  assert.equal(st.consumed, true);
  assert.equal(st.confirmation, "dual-confirmed");
});

test("confirmAuthorizationState fails closed on disagreement", async () => {
  let i = 0;
  const fetchImpl = async () =>
    new Response(JSON.stringify({ result: i++ === 0 ? CONSUMED : NOT_CONSUMED }), { status: 200 });
  const st = await confirmAuthorizationState(BUYER, NONCE, { fetchImpl });
  assert.equal(st.consumed, null);
  assert.equal(st.confirmation, "rpc-disagreement");
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

test("wrapper binds a CONSUMED EIP-3009 authorization and annotates the verdict", async () => {
  const tx = "0x4e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1b1";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000), authUsedLog(BUYER)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (url, init) => {
    if (init && init.method === "POST") {
      const m = rpcMethod(init);
      if (m === "eth_call") return new Response(JSON.stringify({ result: CONSUMED }), { status: 200 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: receipt }), { status: 200 });
    }
    return new Response(JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }), { status: 402 });
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl });
  const res = await vf("https://seller.example/x402/data");
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.verdict, "SETTLED");
  assert.equal(verdict.authorization.status, "consumed");
  assert.match(verdict.note, /authorization consumed on-chain/);
});

test("wrapper FAILS CLOSED when Transfer matches but authorization is NOT consumed (replay/forgery)", async () => {
  const tx = "0x5e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c2";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000), authUsedLog(BUYER)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (url, init) => {
    if (init && init.method === "POST") {
      const m = rpcMethod(init);
      // both RPCs agree the nonce is NOT consumed -> dual-confirmed forgery signal
      if (m === "eth_call") return new Response(JSON.stringify({ result: NOT_CONSUMED }), { status: 200 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: receipt }), { status: 200 });
    }
    return new Response(JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }), { status: 402 });
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl });
  const res = await vf("https://seller.example/x402/data");
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.verdict, "UNVERIFIED");
  assert.equal(verdict.settled, false);
  assert.equal(verdict.authorization.status, "state-mismatch");
  assert.match(verdict.note, /Failing closed/);
});

// ---- signed-payload bind (4-check #4 + the on-chain half of #1) ----
const BLOCK_TS = 1_700_000_300;
function signedHeader({ to = PAYTO, value = "4000", nonce = NONCE, validAfter = "1700000000", validBefore = "1700000600" } = {}) {
  return encodePaymentSignatureHeader({
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      signature: "0x" + "ab".repeat(65),
      authorization: { from: BUYER, to, value, validAfter, validBefore, nonce },
    },
  });
}

test("decodeSignedAuthorization pulls the signed EIP-3009 authorization out of X-PAYMENT", () => {
  const s = decodeSignedAuthorization(signedHeader());
  assert.equal(s.to, PAYTO.toLowerCase());
  assert.equal(s.valueAtomic, 4000);
  assert.equal(s.nonce, NONCE.toLowerCase());
  assert.equal(s.validAfter, 1700000000);
  assert.equal(s.validBefore, 1700000600);
});

test("decodeSignedAuthorization returns null on a missing/garbage header (degrade-open)", () => {
  assert.equal(decodeSignedAuthorization(null), null);
  assert.equal(decodeSignedAuthorization("not-base64-$$"), null);
});

test("computePayloadBind: BOUND when signed nonce == consumed nonce and block in window", () => {
  const s = decodeSignedAuthorization(signedHeader());
  const b = computePayloadBind(s, PAYTO.toLowerCase(), 4000, NONCE.toLowerCase(), BLOCK_TS, "dual-confirmed");
  assert.equal(b.status, "bound");
  assert.equal(b.checks.nonceMatch, true);
  assert.equal(b.checks.windowOk, true);
});

test("computePayloadBind: MISMATCH when the consumed nonce is NOT the one we signed", () => {
  const s = decodeSignedAuthorization(signedHeader());
  const otherNonce = "0x" + "cd".repeat(32);
  const b = computePayloadBind(s, PAYTO.toLowerCase(), 4000, otherNonce, BLOCK_TS, "dual-confirmed");
  assert.equal(b.status, "mismatch");
  assert.equal(b.checks.nonceMatch, false);
});

test("computePayloadBind: WINDOW-VIOLATION when block time is past validBefore", () => {
  const s = decodeSignedAuthorization(signedHeader({ validBefore: "1700000100" }));
  const b = computePayloadBind(s, PAYTO.toLowerCase(), 4000, NONCE.toLowerCase(), BLOCK_TS, "dual-confirmed");
  assert.equal(b.status, "window-violation");
  assert.equal(b.checks.windowOk, false);
});

test("computePayloadBind: UNBOUND when there is no consumed nonce to bind (direct transfer)", () => {
  const s = decodeSignedAuthorization(signedHeader());
  const b = computePayloadBind(s, PAYTO.toLowerCase(), 4000, null, BLOCK_TS, "n/a");
  assert.equal(b.status, "unbound");
});

test("computePayloadBind: NO-PAYLOAD when nothing was captured", () => {
  const b = computePayloadBind(null, PAYTO.toLowerCase(), 4000, NONCE.toLowerCase(), BLOCK_TS, "n/a");
  assert.equal(b.status, "no-payload");
});

test("readBlockTimestamp dual-confirmed when both RPCs agree", async () => {
  const tsHex = "0x" + BLOCK_TS.toString(16);
  const fetchImpl = async () => new Response(JSON.stringify({ result: { timestamp: tsHex } }), { status: 200 });
  const r = await readBlockTimestamp(0x2e8f4a2, { fetchImpl });
  assert.equal(r.timestamp, BLOCK_TS);
  assert.equal(r.confirmation, "dual-confirmed");
});

test("readBlockTimestamp fails closed when RPCs disagree", async () => {
  let i = 0;
  const fetchImpl = async () =>
    new Response(JSON.stringify({ result: { timestamp: "0x" + (BLOCK_TS + i++).toString(16) } }), { status: 200 });
  const r = await readBlockTimestamp(0x2e8f4a2, { fetchImpl });
  assert.equal(r.timestamp, null);
  assert.equal(r.confirmation, "rpc-disagreement");
});

// ---- end-to-end: the payer-only checks wired through the wrapper ----
// Build a fetchImpl that serves the unpaid 402 probe, the receipt read, the
// authorizationState eth_call, and the block-timestamp read.
function fullRpcImpl({ receipt, consumed = CONSUMED, blockTs = BLOCK_TS } = {}) {
  return async (url, init) => {
    if (init && init.method === "POST") {
      const m = rpcMethod(init);
      if (m === "eth_call") return new Response(JSON.stringify({ result: consumed }), { status: 200 });
      if (m === "eth_getBlockByNumber")
        return new Response(JSON.stringify({ result: { timestamp: "0x" + blockTs.toString(16) } }), { status: 200 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: receipt }), { status: 200 });
    }
    return new Response(JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }), { status: 402 });
  };
}

test("wrapper BINDS the signed payload end-to-end (nonce + window) when X-PAYMENT is present", async () => {
  const tx = "0x6e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1d3";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000), authUsedLog(BUYER)] };
  // baseFetch echoes a settled 200; capturingFetch records the x-payment we pass in init.
  const baseFetch = async () => makeSettledResponse(tx);
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl: fullRpcImpl({ receipt }) });
  const res = await vf("https://seller.example/x402/data", { headers: { "x-payment": signedHeader() } });
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.verdict, "SETTLED");
  assert.equal(verdict.payloadBind.status, "bound");
  assert.equal(verdict.payloadBind.checks.nonceMatch, true);
  assert.equal(verdict.payloadBind.checks.windowOk, true);
  assert.match(verdict.note, /signed-payload bound/);
});

test("wrapper FAILS CLOSED when the consumed nonce is not the one we signed", async () => {
  const tx = "0x7e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1e4";
  // receipt's AuthorizationUsed carries a DIFFERENT nonce than the signed one
  const otherNonce = "0x" + "cd".repeat(32);
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000), authUsedLog(BUYER, otherNonce)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl: fullRpcImpl({ receipt }) });
  const res = await vf("https://seller.example/x402/data", { headers: { "x-payment": signedHeader() } });
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.verdict, "UNVERIFIED");
  assert.equal(verdict.settled, false);
  assert.equal(verdict.payloadBind.status, "mismatch");
  assert.match(verdict.note, /SIGNED-PAYLOAD MISMATCH/);
});

test("wrapper FAILS CLOSED on a validity-window violation (dual-confirmed block time)", async () => {
  const tx = "0x8e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1f5";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000), authUsedLog(BUYER)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl: fullRpcImpl({ receipt }) });
  // signed window ends BEFORE the settlement block time
  const res = await vf("https://seller.example/x402/data", { headers: { "x-payment": signedHeader({ validBefore: "1700000100" }) } });
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.verdict, "UNVERIFIED");
  assert.equal(verdict.payloadBind.status, "window-violation");
  assert.match(verdict.note, /VALIDITY-WINDOW VIOLATION/);
});

test("reconcile:off is a pure pass-through payer", async () => {
  const baseFetch = async () => new Response("hi", { status: 200 });
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { reconcile: "off" });
  const res = await vf("https://seller.example/x402/data");
  assert.equal(res.headers.get(SETTLEMENT_HEADER), null);
  assert.equal(await res.text(), "hi");
});

// --- 4th flaw class: cross-resource substitution, end-to-end through wrapper -
test("wrapper binds the resource (DECLARED) when the live 402 declares the matching url", async () => {
  const url = "https://seller.example/x402/data";
  const tx = "0x5e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c2";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (u, init) => {
    if (init && init.method === "POST") return new Response(JSON.stringify({ result: receipt }), { status: 200 });
    // 402 carries resource as the top-level Coinbase-middleware object shape
    return new Response(
      JSON.stringify({ resource: { url, description: "d" }, accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl });
  const res = await vf(url);
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.verdict, "SETTLED");
  assert.equal(verdict.resourceBinding.verdict, "DECLARED");
  assert.equal(verdict.resourceBinding.matches, true);
  assert.equal(verdict.resourceBinding.requestedUrl, url);
  assert.equal(verdict.resourceBinding.schemeBindsResource, false);
});

test("wrapper flags SUBSTITUTABLE when the live 402 declares NO resource", async () => {
  const url = "https://seller.example/x402/data";
  const tx = "0x6e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1d3";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (u, init) => {
    if (init && init.method === "POST") return new Response(JSON.stringify({ result: receipt }), { status: 200 });
    return new Response(JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }), { status: 402 });
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl });
  const res = await vf(url);
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.resourceBinding.verdict, "SUBSTITUTABLE");
  assert.match(verdict.resourceBinding.note, /ANY x402 resource/);
});

test("wrapper fails the resource bind UNVERIFIED when the caller bound `expected` (no live 402 read)", async () => {
  const url = "https://seller.example/x402/data";
  const tx = "0x7e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1e4";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (u, init) => {
    if (init && init.method === "POST") return new Response(JSON.stringify({ result: receipt }), { status: 200 });
    throw new Error("probe must not run when expected is bound");
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), {
    fetchImpl,
    expected: { payTo: PAYTO, amountUsdc: "0.004" },
  });
  const res = await vf(url);
  const verdict = JSON.parse(res.headers.get(SETTLEMENT_HEADER));
  assert.equal(verdict.verdict, "SETTLED");
  assert.equal(verdict.resourceBinding.verdict, "UNVERIFIED");
});

// --- onResourceMismatch: strict agent aborts on wrong/absent resource --------
test("onResourceMismatch=throw raises on RESOURCE_MISMATCH even when money SETTLED", async () => {
  const url = "https://seller.example/x402/data";
  const tx = "0x8e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1f5";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (u, init) => {
    if (init && init.method === "POST") return new Response(JSON.stringify({ result: receipt }), { status: 200 });
    // 402 declares a DIFFERENT resource than the url we fetched
    return new Response(
      JSON.stringify({ resource: { url: "https://seller.example/x402/PREMIUM" }, accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }),
      { status: 402 },
    );
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl, onResourceMismatch: "throw" });
  await assert.rejects(() => vf(url), (e) => {
    assert.ok(e instanceof X402SettlementError);
    assert.equal(e.settlement.verdict, "SETTLED"); // money is fine
    assert.equal(e.settlement.resourceBinding.verdict, "RESOURCE_MISMATCH");
    assert.match(e.message, /resource binding RESOURCE_MISMATCH/);
    return true;
  });
});

test("onResourceMismatch=throw does NOT throw on a plain SUBSTITUTABLE (only strict does)", async () => {
  const url = "https://seller.example/x402/data";
  const tx = "0x9e9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b106";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (u, init) => {
    if (init && init.method === "POST") return new Response(JSON.stringify({ result: receipt }), { status: 200 });
    return new Response(JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }), { status: 402 });
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl, onResourceMismatch: "throw" });
  const res = await vf(url); // no throw
  assert.equal(JSON.parse(res.headers.get(SETTLEMENT_HEADER)).resourceBinding.verdict, "SUBSTITUTABLE");
});

test("onResourceMismatch=strict DOES throw on SUBSTITUTABLE", async () => {
  const url = "https://seller.example/x402/data";
  const tx = "0xae9643e4f7a1c8e6b4d2f0a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b117";
  const receipt = { status: "0x1", blockNumber: "0x2e8f4a2", logs: [usdcLog(BUYER, PAYTO, 4000)] };
  const baseFetch = async () => makeSettledResponse(tx);
  const fetchImpl = async (u, init) => {
    if (init && init.method === "POST") return new Response(JSON.stringify({ result: receipt }), { status: 200 });
    return new Response(JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000" }] }), { status: 402 });
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl, onResourceMismatch: "strict" });
  await assert.rejects(() => vf(url), (e) => {
    assert.equal(e.settlement.resourceBinding.verdict, "SUBSTITUTABLE");
    return true;
  });
});
