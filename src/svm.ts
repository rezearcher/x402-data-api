// ── Solana (SVM) x402 settlement reconcile ──────────────────────────────────
// Cross-rail counterpart to the EVM receipt-verify core. The live x402 growth
// surface (x402.direct, 2026-11-05) is 65.6% Solana (2,637 svc vs 1,273 base),
// yet every named independent x402 verifier (t54 x402-secure, x402-trust.com,
// TrustBench, BlockRun) is EVM-only. This module makes Grey Ridge the only
// cross-rail (Base + Solana) independent x402 settlement verifier.
//
// It reconciles a Solana transaction (fetched keyless via the public
// `getTransaction` JSON-RPC, encoding=jsonParsed) against an advertised SPL-USDC
// payTo owner + amount, using the canonical, deterministic signal: the per-owner
// USDC token-balance DELTA (post - pre) carried in `meta.{pre,post}TokenBalances`.
// Token-balance deltas are the settlement ground truth — they are unaffected by
// instruction-encoding quirks, inner CPIs, or which program moved the tokens, so
// they are the SPL analogue of summing ERC-20 Transfer logs on EVM. We also
// surface any SPL Memo (the x402-solana payment nonce/reference) as a fact.
//
// COGS = $0 (one keyless public RPC read). The verdict enum mirrors the EVM core
// so a buyer gets one shape across both rails.
//
// IMPORTANT (fail-closed by construction): this module reconciles the on-chain
// FACTS regardless of config, but it never fabricates a settlement proof bound to
// US. Binding a Solana settlement to Grey Ridge requires an advertised Solana
// payTo owner; absent one, the verdict is UNVERIFIED (see computeSvmReconcile).

export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // mainnet-beta USDC
export const SVM_USDC_DECIMALS = 6;

// SPL Memo program ids (v1 + v2). Memo data on a jsonParsed tx appears either as a
// parsed `spl-memo` instruction or as a `Program log: Memo (len N): "..."` line.
export const SPL_MEMO_PROGRAM_IDS = [
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // v2
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo", // v1
];

// A Solana tx signature is a base58-encoded 64-byte value (≈87-88 chars; we accept
// the full base58 length band). base58 excludes 0 O I l to avoid ambiguity.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
export function isSolanaSignature(s: string): boolean {
  return typeof s === "string" && s.length >= 64 && s.length <= 100 && BASE58_RE.test(s);
}
// A Solana account/owner address is a base58-encoded 32-byte pubkey (32-44 chars).
export function isSolanaAddress(s: string): boolean {
  return typeof s === "string" && s.length >= 32 && s.length <= 44 && BASE58_RE.test(s);
}

export interface SvmUsdcDelta {
  owner: string | null;        // token-account owner (the economic recipient)
  account_index: number;       // index into the tx account keys
  mint: string;
  pre_atomic: number;
  post_atomic: number;
  delta_atomic: number;        // post - pre; >0 = credited, <0 = debited
}

export interface SvmReconcileResult {
  signature: string;
  network: string;             // caip-2, e.g. "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
  verdict: "SETTLED" | "UNDERPAID" | "WRONG_RECIPIENT" | "NO_TRANSFER" | "REVERTED" | "NOT_FOUND" | "UNVERIFIED";
  settled: boolean;
  tx_status: "success" | "reverted" | "unknown";
  advertised: { payTo: string | null; amount_atomic: number | null; source: "caller" | "self-config" | null };
  matched_transfer: { owner: string; amount_atomic: number } | null;
  usdc_deltas: SvmUsdcDelta[];
  memos: string[];             // decoded SPL-memo strings (x402 payment refs), if any
  slot: number | null;
  block_time: number | null;
  rail: "svm";
  explorer: string;            // solscan link
  note: string;
}

// ── pure decoders (no I/O) ───────────────────────────────────────────────────

type TokenBalance = {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
};

function balAtomic(b: TokenBalance | undefined): number {
  const a = b?.uiTokenAmount?.amount;
  if (typeof a !== "string") return 0;
  const n = Number(a);
  return Number.isFinite(n) ? n : 0;
}

// Compute per-(owner,accountIndex) USDC balance deltas from a getTransaction meta.
// Keyed by accountIndex because the same owner can hold multiple token accounts;
// we union pre+post indices so a freshly-created ATA (no pre entry) is counted.
export function decodeSvmUsdcDeltas(meta: unknown, mint = SOLANA_USDC_MINT): SvmUsdcDelta[] {
  const m = (meta ?? {}) as { preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] };
  const pre = Array.isArray(m.preTokenBalances) ? m.preTokenBalances : [];
  const post = Array.isArray(m.postTokenBalances) ? m.postTokenBalances : [];
  const isUsdc = (b: TokenBalance) => (b.mint ?? "").trim() === mint;
  const indices = new Set<number>();
  for (const b of pre) if (isUsdc(b) && typeof b.accountIndex === "number") indices.add(b.accountIndex);
  for (const b of post) if (isUsdc(b) && typeof b.accountIndex === "number") indices.add(b.accountIndex);
  const out: SvmUsdcDelta[] = [];
  for (const idx of [...indices].sort((a, b) => a - b)) {
    const pb = pre.find((b) => b.accountIndex === idx && isUsdc(b));
    const qb = post.find((b) => b.accountIndex === idx && isUsdc(b));
    const preA = balAtomic(pb);
    const postA = balAtomic(qb);
    const owner = (qb?.owner ?? pb?.owner ?? null) || null;
    out.push({ owner, account_index: idx, mint, pre_atomic: preA, post_atomic: postA, delta_atomic: postA - preA });
  }
  return out;
}

// Pull any SPL-memo payloads out of a jsonParsed tx: both parsed `spl-memo`
// instructions (top-level + inner) and the `Program log: Memo (len N): "..."`
// lines in meta.logMessages. Degrade-open: anything unexpected is skipped.
export function decodeSolanaMemos(txJson: unknown): string[] {
  const out = new Set<string>();
  const tx = (txJson ?? {}) as {
    transaction?: { message?: { instructions?: unknown[] } };
    meta?: { innerInstructions?: { instructions?: unknown[] }[]; logMessages?: unknown[] };
  };
  const scanInstrs = (instrs: unknown[] | undefined) => {
    if (!Array.isArray(instrs)) return;
    for (const raw of instrs) {
      const ix = raw as { program?: string; programId?: string; parsed?: unknown };
      const prog = ix.program ?? "";
      const pid = ix.programId ?? "";
      const isMemo = prog === "spl-memo" || SPL_MEMO_PROGRAM_IDS.includes(pid);
      if (isMemo) {
        if (typeof ix.parsed === "string") out.add(ix.parsed);
        else if (ix.parsed && typeof (ix.parsed as { info?: unknown }).info === "string") out.add((ix.parsed as { info: string }).info);
      }
    }
  };
  scanInstrs(tx.transaction?.message?.instructions);
  for (const inner of tx.meta?.innerInstructions ?? []) scanInstrs(inner.instructions);
  for (const raw of tx.meta?.logMessages ?? []) {
    if (typeof raw !== "string") continue;
    const mm = raw.match(/Program log: Memo \(len \d+\): "(.*)"$/);
    if (mm) out.add(mm[1]);
  }
  return [...out];
}

// ── pure reconcile core (no I/O) ─────────────────────────────────────────────
// Decides the settlement verdict from a fetched getTransaction JSON (or null for
// not-found) against an advertised SPL-USDC payTo owner + expected atomic amount.
//
// payToOwner null => UNVERIFIED-by-construction: we reconcile and report the
// on-chain facts (deltas, memo, status) but REFUSE to assert a settlement bound to
// an unknown recipient. This is what keeps us from ever emitting a false Solana
// settlement proof while no Solana payTo is advertised/configured.
export function computeSvmReconcile(args: {
  signature: string;
  network: string;
  txJson: unknown | null;
  payToOwner: string | null;
  expectAtomic: number | null;
  advertisedSource: SvmReconcileResult["advertised"]["source"];
  mint?: string;
}): SvmReconcileResult {
  const { signature, network, txJson, payToOwner, expectAtomic, advertisedSource } = args;
  const mint = args.mint ?? SOLANA_USDC_MINT;
  const explorer = `https://solscan.io/tx/${signature}`;
  const advertised = { payTo: payToOwner, amount_atomic: expectAtomic, source: advertisedSource };
  const base = { signature, network, advertised, rail: "svm" as const, explorer };

  if (txJson === null || txJson === undefined) {
    return { ...base, verdict: "NOT_FOUND", settled: false, tx_status: "unknown", matched_transfer: null,
      usdc_deltas: [], memos: [], slot: null, block_time: null,
      note: "transaction not found on Solana mainnet via the public RPC — NOT proven absent (could be an unindexed/old slot or a wrong-cluster signature); retry or widen the RPC set" };
  }

  const tx = txJson as { slot?: number; blockTime?: number | null; meta?: { err?: unknown } };
  const slot = typeof tx.slot === "number" ? tx.slot : null;
  const block_time = typeof tx.blockTime === "number" ? tx.blockTime : null;
  const deltas = decodeSvmUsdcDeltas(tx.meta, mint);
  const memos = decodeSolanaMemos(txJson);
  const reverted = tx.meta?.err !== null && tx.meta?.err !== undefined;
  const tx_status: SvmReconcileResult["tx_status"] = reverted ? "reverted" : "success";

  if (reverted) {
    return { ...base, verdict: "REVERTED", settled: false, tx_status, matched_transfer: null,
      usdc_deltas: deltas, memos, slot, block_time,
      note: "the Solana transaction FAILED on-chain (meta.err set) — no USDC settlement occurred regardless of any requested transfer" };
  }

  const credits = deltas.filter((d) => d.delta_atomic > 0);

  // No advertised recipient → reconcile the facts but refuse to bind a settlement.
  if (!payToOwner) {
    const totalCredited = credits.reduce((s, d) => s + d.delta_atomic, 0);
    return { ...base, verdict: "UNVERIFIED", settled: false, tx_status, matched_transfer: null,
      usdc_deltas: deltas, memos, slot, block_time,
      note: credits.length
        ? `decoded ${credits.length} USDC credit(s) totalling ${totalCredited} atomic units on this tx, but no advertised Solana payTo owner was supplied/configured — cannot bind this to a specific recipient, so the settlement is UNVERIFIED by construction (supply &payto=<owner> or set SOLANA_PAY_TO to verify)`
        : "no USDC balance change decoded and no advertised Solana payTo owner supplied — UNVERIFIED by construction" };
  }

  const toUs = credits.filter((d) => d.owner === payToOwner);
  const creditedToUs = toUs.reduce((s, d) => s + d.delta_atomic, 0);

  if (creditedToUs <= 0) {
    // Someone was credited, but not our advertised payTo → wrong recipient.
    if (credits.length > 0) {
      return { ...base, verdict: "WRONG_RECIPIENT", settled: false, tx_status, matched_transfer: null,
        usdc_deltas: deltas, memos, slot, block_time,
        note: `USDC moved on this tx but NOT to the advertised payTo owner ${payToOwner} — the credited owner(s) were [${[...new Set(credits.map((d) => d.owner))].join(", ")}]; do not treat this as a settlement of your payment` };
    }
    return { ...base, verdict: "NO_TRANSFER", settled: false, tx_status, matched_transfer: null,
      usdc_deltas: deltas, memos, slot, block_time,
      note: `transaction succeeded but moved no USDC to the advertised payTo owner ${payToOwner} (no positive USDC balance delta) — not a settlement of this payment` };
  }

  const matched_transfer = { owner: payToOwner, amount_atomic: creditedToUs };

  if (expectAtomic !== null && creditedToUs < expectAtomic) {
    return { ...base, verdict: "UNDERPAID", settled: false, tx_status, matched_transfer,
      usdc_deltas: deltas, memos, slot, block_time,
      note: `USDC credited to the advertised payTo owner (${creditedToUs} atomic) is LESS than the advertised amount (${expectAtomic} atomic) — underpaid by ${expectAtomic - creditedToUs} atomic units` };
  }

  return { ...base, verdict: "SETTLED", settled: true, tx_status, matched_transfer,
    usdc_deltas: deltas, memos, slot, block_time,
    note: expectAtomic !== null
      ? `SETTLED: ${creditedToUs} atomic USDC credited to the advertised payTo owner, ≥ the advertised ${expectAtomic} atomic`
      : `SETTLED: ${creditedToUs} atomic USDC credited to the advertised payTo owner (no advertised amount to check against)` };
}

// ── keyless public Solana RPC read ───────────────────────────────────────────
// Default mainnet public endpoints (no key). getTransaction with jsonParsed +
// maxSupportedTransactionVersion so versioned (v0) txs decode. Degrade-open: a
// null result is a legitimate "not found", an exception is a reachability error.
export const DEFAULT_SOLANA_RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];

export async function solanaGetTransaction(
  rpcUrl: string,
  signature: string,
  fetchImpl: typeof fetch = fetch,
  maxVer = 0,
): Promise<unknown | null> {
  const call = async (ver: number) => {
    const body = {
      jsonrpc: "2.0", id: 1, method: "getTransaction",
      params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: ver }],
    };
    const resp = await fetchImpl(rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`solana rpc ${rpcUrl} http ${resp.status}`);
    return (await resp.json()) as { result?: unknown; error?: { message?: string } };
  };
  let j = await call(maxVer);
  // Some txs are a newer transaction version than the client declared it can
  // parse; the RPC refuses rather than returning the tx. We read ONLY `meta`
  // (pre/postTokenBalances), which is version-independent, so it is always safe
  // to raise the ceiling and retry once. The error names the required version.
  if (j.error && /version/i.test(j.error.message ?? "")) {
    const m = (j.error.message ?? "").match(/version \((\d+)\)/);
    const bump = m ? Math.max(Number(m[1]), maxVer + 1) : 128;
    j = await call(bump);
  }
  if (j.error) throw new Error(`solana rpc error: ${j.error.message ?? "unknown"}`);
  return j.result ?? null; // null = tx not found (not an error)
}
