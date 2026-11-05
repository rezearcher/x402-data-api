/**
 * Contract tests for the Solana (SVM) x402 settlement reconcile
 * (src/svm.ts: decodeSvmUsdcDeltas + decodeSolanaMemos + computeSvmReconcile
 * + isSolanaSignature/isSolanaAddress + solanaGetTransaction I/O wrapper).
 *
 *   node tests/test_svm_reconcile.mjs
 *
 * Cross-rail counterpart to test_x402_receipt_verify.mjs. The reconcile core is
 * pure (fed a getTransaction JSON) and tested directly against synthetic txs
 * built in the real jsonParsed shape; the RPC read is tested with a stubbed
 * fetch. Claims Law: a settlement bound to US requires an advertised payTo owner;
 * absent one the verdict is UNVERIFIED-by-construction (never a false proof).
 */
import assert from "node:assert";

const {
  SOLANA_USDC_MINT,
  SVM_USDC_DECIMALS,
  isSolanaSignature,
  isSolanaAddress,
  decodeSvmUsdcDeltas,
  decodeSolanaMemos,
  computeSvmReconcile,
  solanaGetTransaction,
  DEFAULT_SOLANA_RPCS,
} = await import("../src/svm.ts");

let pass = 0;
function check(name, fn) { return Promise.resolve(fn()).then(() => { pass++; console.log(`ok - ${name}`); }); }

const PAYTO = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";          // our advertised Solana owner
const PAYER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"; // some payer owner
const OTHER = "3n5kFjVfK3aQ1xFk9Wq7cC8hJ2m4pRsT6uVbNxYzA1b";  // unrelated owner
const NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const ONE_USDC = 1_000_000; // 1 USDC @ 6 decimals

// Build a token balance entry in the jsonParsed getTransaction shape.
function tb(accountIndex, owner, atomic, mint = SOLANA_USDC_MINT) {
  return { accountIndex, mint, owner, uiTokenAmount: { amount: String(atomic), decimals: SVM_USDC_DECIMALS } };
}
// Build a synthetic getTransaction result: pre/post USDC balances + optional err/memo.
function txWith({ pre = [], post = [], err = null, memos = [], slot = 285_000_000, blockTime = 1_762_300_000 } = {}) {
  const instructions = memos.map((m) => ({ program: "spl-memo", programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", parsed: m }));
  return {
    slot, blockTime,
    meta: { err, preTokenBalances: pre, postTokenBalances: post, innerInstructions: [], logMessages: [] },
    transaction: { message: { instructions } },
  };
}

await check("isSolanaSignature accepts a base58 88-char sig, rejects an EVM hash", () => {
  assert.equal(isSolanaSignature(SIG), true);
  assert.equal(isSolanaSignature("0x" + "a".repeat(64)), false, "EVM hash is not a solana sig (0x prefix)");
  assert.equal(isSolanaSignature("short"), false);
  assert.equal(isSolanaSignature("0OIl".repeat(20)), false, "base58 excludes 0 O I l");
});

await check("isSolanaAddress accepts a 44-char owner, rejects EVM addr", () => {
  assert.equal(isSolanaAddress(PAYTO), true);
  assert.equal(isSolanaAddress("0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10"), false);
});

await check("decodeSvmUsdcDeltas computes post-pre per owner for the USDC mint only", () => {
  const meta = {
    preTokenBalances: [tb(3, PAYER, 5 * ONE_USDC), tb(4, PAYTO, 0)],
    postTokenBalances: [tb(3, PAYER, 4 * ONE_USDC), tb(4, PAYTO, ONE_USDC)],
  };
  const d = decodeSvmUsdcDeltas(meta);
  const us = d.find((x) => x.owner === PAYTO);
  const payer = d.find((x) => x.owner === PAYER);
  assert.equal(us.delta_atomic, ONE_USDC, "payTo credited +1 USDC");
  assert.equal(payer.delta_atomic, -ONE_USDC, "payer debited -1 USDC");
});

await check("decodeSvmUsdcDeltas ignores non-USDC mints and counts a fresh ATA (no pre)", () => {
  const meta = {
    preTokenBalances: [],
    postTokenBalances: [tb(4, PAYTO, ONE_USDC), { accountIndex: 5, mint: "SomeOtherMint111111111111111111111111111111", owner: OTHER, uiTokenAmount: { amount: "999", decimals: 6 } }],
  };
  const d = decodeSvmUsdcDeltas(meta);
  assert.equal(d.length, 1, "only the USDC balance is decoded");
  assert.equal(d[0].delta_atomic, ONE_USDC, "fresh ATA with no pre counts full credit");
});

await check("decodeSolanaMemos reads parsed spl-memo + Program log memo lines", () => {
  const tx = txWith({ memos: ["x402:ref-abc123"] });
  tx.meta.logMessages = ['Program log: Memo (len 9): "logmemo42"'];
  const memos = decodeSolanaMemos(tx);
  assert.ok(memos.includes("x402:ref-abc123"), "parsed memo decoded");
  assert.ok(memos.includes("logmemo42"), "log-line memo decoded");
});

await check("computeSvmReconcile → SETTLED when payTo credited >= advertised amount", () => {
  const tx = txWith({
    pre: [tb(3, PAYER, 5 * ONE_USDC), tb(4, PAYTO, 0)],
    post: [tb(3, PAYER, 4 * ONE_USDC), tb(4, PAYTO, ONE_USDC)],
    memos: ["x402:order-7"],
  });
  const r = computeSvmReconcile({ signature: SIG, network: NETWORK, txJson: tx, payToOwner: PAYTO, expectAtomic: ONE_USDC, advertisedSource: "self-config" });
  assert.equal(r.verdict, "SETTLED");
  assert.equal(r.settled, true);
  assert.equal(r.tx_status, "success");
  assert.equal(r.matched_transfer.amount_atomic, ONE_USDC);
  assert.equal(r.matched_transfer.owner, PAYTO);
  assert.deepEqual(r.memos, ["x402:order-7"]);
  assert.equal(r.rail, "svm");
  assert.ok(r.explorer.includes(SIG));
});

await check("computeSvmReconcile → UNDERPAID when credited < advertised", () => {
  const tx = txWith({ pre: [tb(4, PAYTO, 0)], post: [tb(4, PAYTO, ONE_USDC / 2)] });
  const r = computeSvmReconcile({ signature: SIG, network: NETWORK, txJson: tx, payToOwner: PAYTO, expectAtomic: ONE_USDC, advertisedSource: "caller" });
  assert.equal(r.verdict, "UNDERPAID");
  assert.equal(r.settled, false);
  assert.equal(r.matched_transfer.amount_atomic, ONE_USDC / 2);
});

await check("computeSvmReconcile → WRONG_RECIPIENT when USDC went to someone else", () => {
  const tx = txWith({ pre: [tb(4, OTHER, 0)], post: [tb(4, OTHER, ONE_USDC)] });
  const r = computeSvmReconcile({ signature: SIG, network: NETWORK, txJson: tx, payToOwner: PAYTO, expectAtomic: ONE_USDC, advertisedSource: "caller" });
  assert.equal(r.verdict, "WRONG_RECIPIENT");
  assert.equal(r.settled, false);
  assert.equal(r.matched_transfer, null);
  assert.ok(r.note.includes(OTHER));
});

await check("computeSvmReconcile → NO_TRANSFER when success but no USDC moved to payTo", () => {
  const tx = txWith({ pre: [tb(4, PAYTO, ONE_USDC)], post: [tb(4, PAYTO, ONE_USDC)] });
  const r = computeSvmReconcile({ signature: SIG, network: NETWORK, txJson: tx, payToOwner: PAYTO, expectAtomic: ONE_USDC, advertisedSource: "caller" });
  assert.equal(r.verdict, "NO_TRANSFER");
  assert.equal(r.settled, false);
});

await check("computeSvmReconcile → REVERTED when meta.err is set (no settlement)", () => {
  const tx = txWith({ pre: [tb(4, PAYTO, 0)], post: [tb(4, PAYTO, ONE_USDC)], err: { InstructionError: [0, "Custom"] } });
  const r = computeSvmReconcile({ signature: SIG, network: NETWORK, txJson: tx, payToOwner: PAYTO, expectAtomic: ONE_USDC, advertisedSource: "caller" });
  assert.equal(r.verdict, "REVERTED");
  assert.equal(r.settled, false);
  assert.equal(r.tx_status, "reverted");
});

await check("computeSvmReconcile → NOT_FOUND when txJson is null (not proven absent)", () => {
  const r = computeSvmReconcile({ signature: SIG, network: NETWORK, txJson: null, payToOwner: PAYTO, expectAtomic: ONE_USDC, advertisedSource: "caller" });
  assert.equal(r.verdict, "NOT_FOUND");
  assert.equal(r.settled, false);
  assert.ok(r.note.toLowerCase().includes("not proven absent"));
});

await check("computeSvmReconcile → UNVERIFIED-by-construction when no advertised payTo (even on a real credit)", () => {
  const tx = txWith({ pre: [tb(4, PAYTO, 0)], post: [tb(4, PAYTO, ONE_USDC)] });
  const r = computeSvmReconcile({ signature: SIG, network: NETWORK, txJson: tx, payToOwner: null, expectAtomic: null, advertisedSource: null });
  assert.equal(r.verdict, "UNVERIFIED", "no payTo => never a settlement proof");
  assert.equal(r.settled, false);
  assert.equal(r.matched_transfer, null, "no binding without an advertised recipient");
  assert.equal(r.usdc_deltas.length, 1, "but the on-chain facts are still surfaced");
  assert.ok(r.note.includes("UNVERIFIED by construction"));
});

await check("computeSvmReconcile → SETTLED with no advertised amount still binds to payTo", () => {
  const tx = txWith({ pre: [tb(4, PAYTO, 0)], post: [tb(4, PAYTO, 3 * ONE_USDC)] });
  const r = computeSvmReconcile({ signature: SIG, network: NETWORK, txJson: tx, payToOwner: PAYTO, expectAtomic: null, advertisedSource: "self-config" });
  assert.equal(r.verdict, "SETTLED");
  assert.equal(r.matched_transfer.amount_atomic, 3 * ONE_USDC);
});

await check("solanaGetTransaction returns result on 200, null on jsonrpc null, throws on error", async () => {
  const okTx = txWith({ pre: [tb(4, PAYTO, 0)], post: [tb(4, PAYTO, ONE_USDC)] });
  const fetchOk = async () => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: okTx }) });
  const got = await solanaGetTransaction(DEFAULT_SOLANA_RPCS[0], SIG, fetchOk);
  assert.equal(got.slot, okTx.slot);

  const fetchNull = async () => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: null }) });
  const none = await solanaGetTransaction(DEFAULT_SOLANA_RPCS[0], SIG, fetchNull);
  assert.equal(none, null, "jsonrpc result null => not found");

  const fetchErr = async () => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "boom" } }) });
  await assert.rejects(() => solanaGetTransaction(DEFAULT_SOLANA_RPCS[0], SIG, fetchErr), /boom/);

  const fetch500 = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => solanaGetTransaction(DEFAULT_SOLANA_RPCS[0], SIG, fetch500), /503/);
});

console.log(`\n${pass} checks passed`);
