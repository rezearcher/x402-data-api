/**
 * Minimal, dependency-free Base-mainnet receipt reader. Reads an
 * eth_getTransactionReceipt over plain JSON-RPC (fetch) from one or two
 * independent public providers and cross-confirms their settlement content —
 * so a single RPC returning a stale/forged receipt cannot move the verdict on
 * its own. No viem, no SDK; just the global fetch the agent already has.
 */

import {
  decodeUsdcTransfers,
  receiptStatus,
  type ReceiptTransfer,
} from "./reconcile.js";

/** Public Base-mainnet JSON-RPC endpoints (no key). Two distinct providers. */
export const DEFAULT_BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
];

export interface ReceiptRead {
  found: boolean;
  status: "success" | "reverted" | "unknown" | null;
  transfers: ReceiptTransfer[];
  block: number | null;
  /** Which RPC providers agreed on the settlement content. */
  confirmation: "dual-confirmed" | "single-source" | "rpc-disagreement" | "not-found";
  sources: string[];
}

/** Order-independent fingerprint of (status + USDC transfers) for cross-confirm. */
function fingerprint(status: ReceiptRead["status"], transfers: ReceiptTransfer[]): string {
  const norm = transfers
    .map((t) => `${t.from.toLowerCase()}>${t.to.toLowerCase()}:${t.amount_atomic}`)
    .sort()
    .join("|");
  return `${status ?? "null"}#${norm}`;
}

async function rpcGetReceipt(
  rpcUrl: string,
  txHash: string,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<{ ok: boolean; receipt: unknown | null }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }),
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, receipt: null };
    const j = (await res.json()) as { result?: unknown; error?: unknown };
    if (j.error) return { ok: false, receipt: null };
    return { ok: true, receipt: j.result ?? null };
  } catch {
    return { ok: false, receipt: null };
  } finally {
    clearTimeout(t);
  }
}

function readOne(receipt: unknown): { status: ReceiptRead["status"]; transfers: ReceiptTransfer[]; block: number | null } {
  if (receipt === null || receipt === undefined) return { status: null, transfers: [], block: null };
  const r = receipt as { status?: string; logs?: unknown[]; blockNumber?: string };
  const status = receiptStatus(r.status);
  const transfers = decodeUsdcTransfers(r.logs ?? []);
  let block: number | null = null;
  try {
    block = r.blockNumber ? Number(BigInt(r.blockNumber)) : null;
  } catch {
    block = null;
  }
  return { status, transfers, block };
}

/**
 * Read a Base-mainnet receipt and cross-confirm across up to two RPC providers.
 * - both reachable + agree  => dual-confirmed
 * - both reachable + differ => rpc-disagreement (fail closed; status set null)
 * - one reachable           => single-source (degrade-open, disclosed)
 * - none / no receipt        => not-found
 */
export async function readSettlementReceipt(
  txHash: string,
  opts: { rpcUrls?: string[]; fetchImpl?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<ReceiptRead> {
  const rpcUrls = (opts.rpcUrls && opts.rpcUrls.length ? opts.rpcUrls : DEFAULT_BASE_RPCS).slice(0, 2);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 7000;

  const reads = await Promise.all(rpcUrls.map((u) => rpcGetReceipt(u, txHash, fetchImpl, timeoutMs)));
  const live = reads
    .map((r, i) => ({ ...r, url: rpcUrls[i] }))
    .filter((r) => r.ok);

  if (live.length === 0) {
    return { found: false, status: null, transfers: [], block: null, confirmation: "not-found", sources: [] };
  }
  if (live.length === 1) {
    const one = readOne(live[0].receipt);
    return {
      found: one.status !== null,
      status: one.status,
      transfers: one.transfers,
      block: one.block,
      confirmation: "single-source",
      sources: [live[0].url],
    };
  }
  // Two independent reads — cross-confirm.
  const a = readOne(live[0].receipt);
  const b = readOne(live[1].receipt);
  if (fingerprint(a.status, a.transfers) === fingerprint(b.status, b.transfers)) {
    return {
      found: a.status !== null,
      status: a.status,
      transfers: a.transfers,
      block: a.block ?? b.block,
      confirmation: "dual-confirmed",
      sources: [live[0].url, live[1].url],
    };
  }
  // Disagreement — fail closed: do not hand back a status we can't trust.
  return {
    found: false,
    status: null,
    transfers: [],
    block: null,
    confirmation: "rpc-disagreement",
    sources: [live[0].url, live[1].url],
  };
}
