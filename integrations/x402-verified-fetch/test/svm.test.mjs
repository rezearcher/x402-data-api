import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeSvmReconcile,
  readSolanaSettlement,
  decodeSvmUsdcDeltas,
  decodeSolanaMemos,
  svmFingerprint,
  isSolanaRail,
  isSolanaSignature,
  isSolanaAddress,
  SOLANA_USDC_MINT,
  wrapFetchWithVerifiedPayment,
  X402SettlementError,
  SETTLEMENT_HEADER,
} from "../dist/index.js";
import { encodePaymentResponseHeader } from "@x402/core/http";
import { x402Client } from "@x402/fetch";

// A valid-format base58 Solana signature (64-100 chars, no 0/O/I/l, not 0x).
const SIG = "5" + "Kd8xYZ3aBcEfGhJmNpQrStUvWxyz123456789ABCDEFGHJKLMNPQRSTUVWXYZabcde";
// SPL-USDC token-account owners (base58 pubkeys, 32-44 chars).
const PAYTO = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OTHER = "3nMZ3a7LmQw8yF6pR2tVxKdEuHjNcB1oZsYgWqUvTrLm";

function svmResult({ owner = PAYTO, pre = 0, post = 4000, err = null, memo = null, slot = 1234, blockTime = 1_700_000_000, idx = 3 } = {}) {
  return {
    slot,
    blockTime,
    meta: {
      err,
      preTokenBalances: [{ accountIndex: idx, mint: SOLANA_USDC_MINT, owner, uiTokenAmount: { amount: String(pre), decimals: 6 } }],
      postTokenBalances: [{ accountIndex: idx, mint: SOLANA_USDC_MINT, owner, uiTokenAmount: { amount: String(post), decimals: 6 } }],
      logMessages: memo ? [`Program log: Memo (len ${memo.length}): "${memo}"`] : [],
    },
  };
}

// ---- format guards ----
test("rail + address format guards", () => {
  assert.equal(isSolanaSignature(SIG), true);
  assert.equal(isSolanaSignature("0x" + "ab".repeat(32)), false); // EVM hash is not SVM
  assert.equal(isSolanaAddress(PAYTO), true);
  assert.equal(isSolanaAddress("0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10"), false);
  assert.equal(isSolanaRail("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", SIG), true);
  assert.equal(isSolanaRail("base", "0xabc"), false);
  assert.equal(isSolanaRail(null, SIG), true); // no label + base58 sig => SVM
  assert.equal(isSolanaRail("eip155:8453", "0xabc"), false);
});

// ---- pure decoders ----
test("decodeSvmUsdcDeltas computes per-owner delta (incl fresh ATA)", () => {
  const deltas = decodeSvmUsdcDeltas(svmResult({ pre: 1000, post: 5000 }).meta);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].owner, PAYTO);
  assert.equal(deltas[0].delta_atomic, 4000);
});

test("decodeSolanaMemos pulls the x402 payment ref", () => {
  const memos = decodeSolanaMemos(svmResult({ memo: "x402:ref-abc123" }));
  assert.deepEqual(memos, ["x402:ref-abc123"]);
});

test("svmFingerprint is recipient-independent and stable", () => {
  const a = svmResult({ post: 4000 });
  const b = svmResult({ post: 4000 });
  assert.equal(svmFingerprint(a), svmFingerprint(b));
  assert.notEqual(svmFingerprint(a), svmFingerprint(svmResult({ post: 9000 })));
});

// ---- pure reconcile core ----
test("computeSvmReconcile => SETTLED when payTo credited >= amount", () => {
  const r = computeSvmReconcile({
    signature: SIG, network: "solana:mainnet",
    txJson: svmResult({ post: 4000 }), payToOwner: PAYTO, expectAtomic: 4000, advertisedSource: "live-402",
  });
  assert.equal(r.verdict, "SETTLED");
  assert.equal(r.settled, true);
  assert.equal(r.matched_transfer.amount_atomic, 4000);
  assert.equal(r.rail, "svm");
});

test("computeSvmReconcile => UNVERIFIED by construction when no payTo supplied", () => {
  const r = computeSvmReconcile({
    signature: SIG, network: "solana:mainnet",
    txJson: svmResult({ post: 4000 }), payToOwner: null, expectAtomic: 4000, advertisedSource: null,
  });
  assert.equal(r.verdict, "UNVERIFIED");
  assert.equal(r.settled, false);
  assert.match(r.note, /UNVERIFIED by construction/);
});

test("computeSvmReconcile => WRONG_RECIPIENT when USDC went to another owner", () => {
  const r = computeSvmReconcile({
    signature: SIG, network: "solana:mainnet",
    txJson: svmResult({ owner: OTHER, post: 4000 }), payToOwner: PAYTO, expectAtomic: 4000, advertisedSource: "caller",
  });
  assert.equal(r.verdict, "WRONG_RECIPIENT");
  assert.equal(r.settled, false);
});

test("computeSvmReconcile => UNDERPAID when credited < amount", () => {
  const r = computeSvmReconcile({
    signature: SIG, network: "solana:mainnet",
    txJson: svmResult({ post: 1500 }), payToOwner: PAYTO, expectAtomic: 4000, advertisedSource: "live-402",
  });
  assert.equal(r.verdict, "UNDERPAID");
});

test("computeSvmReconcile => REVERTED when meta.err set", () => {
  const r = computeSvmReconcile({
    signature: SIG, network: "solana:mainnet",
    txJson: svmResult({ err: { InstructionError: [0, "Custom"] }, post: 4000 }), payToOwner: PAYTO, expectAtomic: 4000, advertisedSource: "live-402",
  });
  assert.equal(r.verdict, "REVERTED");
});

test("computeSvmReconcile => NOT_FOUND when tx absent", () => {
  const r = computeSvmReconcile({
    signature: SIG, network: "solana:mainnet",
    txJson: null, payToOwner: PAYTO, expectAtomic: 4000, advertisedSource: "live-402",
  });
  assert.equal(r.verdict, "NOT_FOUND");
});

test("computeSvmReconcile => UNVERIFIED on rpc-disagreement (fail closed)", () => {
  const r = computeSvmReconcile({
    signature: SIG, network: "solana:mainnet",
    txJson: svmResult({ post: 4000 }), payToOwner: PAYTO, expectAtomic: 4000, advertisedSource: "live-402",
    confirmation: "rpc-disagreement", sources: ["a", "b"],
  });
  assert.equal(r.verdict, "UNVERIFIED");
  assert.equal(r.settled, false);
  assert.match(r.note, /disagreed/);
});

// ---- dual-RPC reader ----
function solRpc(results) {
  // results: array of getTransaction `result` payloads (one per provider, in order)
  let i = 0;
  return async () => {
    const result = results[i++ % results.length];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
}

test("readSolanaSettlement => dual-confirmed when both RPCs agree", async () => {
  const r = svmResult({ post: 4000 });
  const read = await readSolanaSettlement(SIG, { fetchImpl: solRpc([r, r]) });
  assert.equal(read.found, true);
  assert.equal(read.confirmation, "dual-confirmed");
  assert.equal(read.sources.length, 2);
});

test("readSolanaSettlement => rpc-disagreement when providers differ", async () => {
  const read = await readSolanaSettlement(SIG, { fetchImpl: solRpc([svmResult({ post: 4000 }), svmResult({ post: 9000 })]) });
  assert.equal(read.confirmation, "rpc-disagreement");
});

test("readSolanaSettlement => not-found when tx absent on all RPCs", async () => {
  const read = await readSolanaSettlement(SIG, { fetchImpl: solRpc([null, null]) });
  assert.equal(read.found, false);
  assert.equal(read.confirmation, "not-found");
});

// ---- end-to-end wrapper (cross-rail) ----
test("wrapper reconciles a Solana USDC settlement to SETTLED via the SVM rail", async () => {
  const header = encodePaymentResponseHeader({
    success: true,
    transaction: SIG,
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    payer: OTHER,
    amount: "4000",
  });
  const baseFetch = async () =>
    new Response(JSON.stringify({ ok: true, data: "paid-content" }), {
      status: 200,
      headers: { "content-type": "application/json", "payment-response": header },
    });
  const result = svmResult({ post: 4000, memo: "x402:ref-xyz" });
  const fetchImpl = async (url, init) => {
    if (init && init.method === "POST") {
      // Solana getTransaction RPC read
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    }
    // unpaid probe -> 402 advertising a SOLANA payTo
    return new Response(
      JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }] }),
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
  assert.equal(verdict.rail, "svm");
  assert.equal(verdict.svm.matched_transfer.amount_atomic, 4000);
  assert.equal(verdict.svm.memos[0], "x402:ref-xyz");
  assert.equal(verdict.authorization, null); // EIP-3009 is EVM-only
  assert.equal(captured.rail, "svm");
  const body = await res.json();
  assert.equal(body.data, "paid-content");
});

test("wrapper throws on a Solana WRONG_RECIPIENT when onMismatch=throw", async () => {
  const header = encodePaymentResponseHeader({
    success: true, transaction: SIG, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", payer: OTHER, amount: "4000",
  });
  const baseFetch = async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "payment-response": header } });
  const result = svmResult({ owner: OTHER, post: 4000 }); // credited someone else
  const fetchImpl = async (url, init) => {
    if (init && init.method === "POST") return new Response(JSON.stringify({ result }), { status: 200 });
    return new Response(
      JSON.stringify({ accepts: [{ scheme: "exact", payTo: PAYTO, amount: "4000", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }] }),
      { status: 402 },
    );
  };
  const vf = wrapFetchWithVerifiedPayment(baseFetch, new x402Client(), { fetchImpl, onMismatch: "throw" });
  await assert.rejects(
    () => vf("https://seller.example/x402/data"),
    (e) => {
      assert.ok(e instanceof X402SettlementError);
      assert.equal(e.settlement.verdict, "WRONG_RECIPIENT");
      assert.equal(e.settlement.rail, "svm");
      return true;
    },
  );
});
