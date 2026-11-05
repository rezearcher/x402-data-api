/**
 * Cross-rail (Solana / SVM) settlement reconcile for the verified-fetch wrapper.
 *
 * The live x402 growth surface (x402.direct, 2026-11-05) is 65.6% Solana (2,637
 * services vs 1,273 Base), yet every named independent x402 verify wrapper
 * (t54 x402-secure, x402-trust.com, TrustBench, BlockRun) is EVM-only. This
 * module makes @grey-ridge/x402-verified-fetch the ONLY x402 fetch wrapper that
 * reconciles both rails on-chain — and it is especially timely given
 * GHSA-qr2g-p6q7-w82m (a Solana x402 facilitator signature-bypass, fixed in
 * @x402/svm 2.6.0): a client that reads the Solana chain itself does not have to
 * trust any facilitator's /verify.
 *
 * The reconcile is a faithful port of the verdict core that powers Grey Ridge's
 * hosted /x402/receipt-verify, so a local SVM reconcile agrees with the hosted
 * one. It uses the canonical deterministic signal — the per-owner USDC
 * token-balance DELTA (post - pre) from `meta.{pre,post}TokenBalances` — which is
 * the SPL analogue of summing ERC-20 Transfer logs and is unaffected by
 * instruction encoding, inner CPIs, or which program moved the tokens.
 *
 * Pure + dependency-free + $0 COGS (keyless public getTransaction read). The
 * verdict enum mirrors the EVM core so a buyer gets one shape across both rails.
 *
 * Fail-closed by construction: with no advertised Solana payTo owner we report
 * the on-chain FACTS but refuse to assert a settlement bound to an unknown
 * recipient (verdict UNVERIFIED) — so the wrapper never emits a false Solana
 * settlement proof.
 */

import type { SettlementVerdict } from "./reconcile.js";

/** mainnet-beta USDC mint (6 decimals). */
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SVM_USDC_DECIMALS = 6;

/** SPL Memo program ids (v1 + v2) — the x402-solana payment nonce/reference carrier. */
export const SPL_MEMO_PROGRAM_IDS = [
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // v2
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo", // v1
];

// A Solana tx signature is a base58-encoded 64-byte value (~87-88 chars). base58
// excludes 0 O I l. EVM tx hashes are 0x + 64 hex, so the two never collide.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
export function isSolanaSignature(s: string): boolean {
  return typeof s === "string" && s.length >= 64 && s.length <= 100 && !s.startsWith("0x") && BASE58_RE.test(s);
}
/** A Solana account/owner address is a base58-encoded 32-byte pubkey (32-44 chars). */
export function isSolanaAddress(s: string): boolean {
  return typeof s === "string" && s.length >= 32 && s.length <= 44 && !s.startsWith("0x") && BASE58_RE.test(s);
}

/** True when a decoded PAYMENT-RESPONSE / 402 points at the Solana rail. */
export function isSolanaRail(network: string | null, tx: string | null): boolean {
  if (network && /^solana\b/i.test(network)) return true;
  // No network label but a base58 signature that is not an EVM 0x hash => SVM.
  if (!network && tx && isSolanaSignature(tx)) return true;
  return false;
}

export interface SvmUsdcDelta {
  owner: string | null;
  account_index: number;
  mint: string;
  pre_atomic: number;
  post_atomic: number;
  delta_atomic: number; // post - pre; >0 credited, <0 debited
}

export interface SvmReconcileResult {
  signature: string;
  network: string;
  verdict: SettlementVerdict;
  settled: boolean;
  tx_status: "success" | "reverted" | "unknown";
  advertised: { payTo: string | null; amount_atomic: number | null; source: "caller" | "live-402" | "self-config" | null };
  matched_transfer: { owner: string; amount_atomic: number } | null;
  usdc_deltas: SvmUsdcDelta[];
  memos: string[];
  slot: number | null;
  block_time: number | null;
  rail: "svm";
  /** Which RPC providers agreed on the decoded settlement content. */
  confirmation: "dual-confirmed" | "single-source" | "rpc-disagreement" | "not-found";
  sources: string[];
  explorer: string;
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

/**
 * Per-(owner,accountIndex) USDC balance deltas from a getTransaction meta. Keyed
 * by accountIndex (one owner can hold multiple token accounts); unions pre+post
 * indices so a freshly-created ATA (no pre entry) is counted. Degrade-open.
 */
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

/** Pull any SPL-memo payloads (the x402-solana payment ref) out of a jsonParsed tx. */
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

/**
 * Order-independent fingerprint of (status + USDC credit deltas + memos) for
 * cross-confirming two independent RPC reads. Recipient-independent so it can be
 * computed before the payTo is known.
 */
export function svmFingerprint(txJson: unknown, mint = SOLANA_USDC_MINT): string {
  if (txJson === null || txJson === undefined) return "null";
  const tx = txJson as { meta?: { err?: unknown } };
  const reverted = tx.meta?.err !== null && tx.meta?.err !== undefined;
  const deltas = decodeSvmUsdcDeltas((txJson as { meta?: unknown }).meta, mint)
    .map((d) => `${d.owner ?? "?"}@${d.account_index}:${d.delta_atomic}`)
    .sort()
    .join("|");
  const memos = decodeSolanaMemos(txJson).sort().join("~");
  return `${reverted ? "reverted" : "ok"}#${deltas}@${memos}`;
}

// ── pure reconcile core (no I/O) ─────────────────────────────────────────────

/**
 * Verdict from a fetched getTransaction JSON (or null for not-found) against an
 * advertised SPL-USDC payTo owner + expected atomic amount. payToOwner null =>
 * UNVERIFIED by construction (report facts, refuse to bind to an unknown owner).
 */
export function computeSvmReconcile(args: {
  signature: string;
  network: string;
  txJson: unknown | null;
  payToOwner: string | null;
  expectAtomic: number | null;
  advertisedSource: SvmReconcileResult["advertised"]["source"];
  confirmation?: SvmReconcileResult["confirmation"];
  sources?: string[];
  mint?: string;
}): SvmReconcileResult {
  const { signature, network, txJson, payToOwner, expectAtomic, advertisedSource } = args;
  const mint = args.mint ?? SOLANA_USDC_MINT;
  const explorer = `https://solscan.io/tx/${signature}`;
  const advertised = { payTo: payToOwner, amount_atomic: expectAtomic, source: advertisedSource };
  const confirmation = args.confirmation ?? (txJson == null ? "not-found" : "single-source");
  const sources = args.sources ?? [];
  const base = { signature, network, advertised, rail: "svm" as const, explorer, confirmation, sources };

  // Two providers disagreed on the decoded content → fail closed.
  if (confirmation === "rpc-disagreement") {
    return { ...base, verdict: "UNVERIFIED", settled: false, tx_status: "unknown", matched_transfer: null,
      usdc_deltas: [], memos: [], slot: null, block_time: null,
      note: "two independent Solana RPCs disagreed on this transaction's decoded USDC movement — failing closed rather than trusting a single source" };
  }

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

  if (!payToOwner) {
    const totalCredited = credits.reduce((s, d) => s + d.delta_atomic, 0);
    return { ...base, verdict: "UNVERIFIED", settled: false, tx_status, matched_transfer: null,
      usdc_deltas: deltas, memos, slot, block_time,
      note: credits.length
        ? `decoded ${credits.length} USDC credit(s) totalling ${totalCredited} atomic units on this tx, but no advertised Solana payTo owner was supplied — cannot bind this to a specific recipient, so the settlement is UNVERIFIED by construction (pass expected.payTo = the SPL-USDC owner you paid)`
        : "no USDC balance change decoded and no advertised Solana payTo owner supplied — UNVERIFIED by construction" };
  }

  const toUs = credits.filter((d) => d.owner === payToOwner);
  const creditedToUs = toUs.reduce((s, d) => s + d.delta_atomic, 0);

  if (creditedToUs <= 0) {
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
      ? `SETTLED: ${creditedToUs} atomic USDC credited to the advertised payTo owner, >= the advertised ${expectAtomic} atomic`
      : `SETTLED: ${creditedToUs} atomic USDC credited to the advertised payTo owner (no advertised amount to check against)` };
}

// ── keyless public Solana RPC read ───────────────────────────────────────────

/** Default mainnet public endpoints (no key). */
export const DEFAULT_SOLANA_RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];

/**
 * getTransaction (jsonParsed, confirmed) with a one-shot version-ceiling retry
 * (we read only version-independent `meta`, so raising the ceiling is safe) and
 * an AbortController timeout. Returns null for a genuine not-found; throws on a
 * reachability/RPC error so the caller can fall through to the next provider.
 */
export async function solanaGetTransaction(
  rpcUrl: string,
  signature: string,
  fetchImpl: typeof globalThis.fetch = fetch,
  timeoutMs = 7000,
  maxVer = 0,
): Promise<unknown | null> {
  const call = async (ver: number) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "getTransaction",
          params: [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: ver }],
        }),
        signal: ctl.signal,
      });
      if (!resp.ok) throw new Error(`solana rpc ${rpcUrl} http ${resp.status}`);
      return (await resp.json()) as { result?: unknown; error?: { message?: string } };
    } finally {
      clearTimeout(t);
    }
  };
  let j = await call(maxVer);
  if (j.error && /version/i.test(j.error.message ?? "")) {
    const m = (j.error.message ?? "").match(/version \((\d+)\)/);
    const bump = m ? Math.max(Number(m[1]), maxVer + 1) : 128;
    j = await call(bump);
  }
  if (j.error) throw new Error(`solana rpc error: ${j.error.message ?? "unknown"}`);
  return j.result ?? null;
}

export interface SolanaRead {
  found: boolean;
  txJson: unknown | null;
  confirmation: SvmReconcileResult["confirmation"];
  sources: string[];
}

/**
 * Read a Solana settlement and cross-confirm across up to two public RPCs — the
 * same fail-closed discipline the EVM path uses:
 *  - both reachable + agree on the decoded USDC movement => dual-confirmed
 *  - both reachable + differ                              => rpc-disagreement (fail closed)
 *  - one reachable                                        => single-source (degrade-open, disclosed)
 *  - none reachable / tx absent on all                    => not-found
 */
export async function readSolanaSettlement(
  signature: string,
  opts: { rpcUrls?: string[]; fetchImpl?: typeof globalThis.fetch; timeoutMs?: number; mint?: string } = {},
): Promise<SolanaRead> {
  const rpcUrls = (opts.rpcUrls && opts.rpcUrls.length ? opts.rpcUrls : DEFAULT_SOLANA_RPCS).slice(0, 2);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 7000;
  const mint = opts.mint ?? SOLANA_USDC_MINT;

  const reads = await Promise.all(
    rpcUrls.map(async (u) => {
      try {
        return { url: u, ok: true, txJson: await solanaGetTransaction(u, signature, fetchImpl, timeoutMs) };
      } catch {
        return { url: u, ok: false, txJson: null as unknown };
      }
    }),
  );

  const reachable = reads.filter((r) => r.ok);
  const withTx = reachable.filter((r) => r.txJson !== null && r.txJson !== undefined);

  if (withTx.length === 0) {
    // reachable but every read was a genuine null => not-found; none reachable also not-found
    return { found: false, txJson: null, confirmation: "not-found", sources: reachable.map((r) => r.url) };
  }

  if (withTx.length >= 2) {
    const [a, b] = withTx;
    if (svmFingerprint(a.txJson, mint) === svmFingerprint(b.txJson, mint)) {
      return { found: true, txJson: a.txJson, confirmation: "dual-confirmed", sources: withTx.map((r) => r.url) };
    }
    return { found: true, txJson: a.txJson, confirmation: "rpc-disagreement", sources: withTx.map((r) => r.url) };
  }

  return { found: true, txJson: withTx[0].txJson, confirmation: "single-source", sources: withTx.map((r) => r.url) };
}
