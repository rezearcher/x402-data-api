// Grey Ridge x402 — runnable cross-venue funding-arb scanner.
//
// Scans live perpetual funding-rate spreads across Hyperliquid, OKX and dYdX and
// ranks the widest cross-venue arb candidates, using the keyless x402 payment loop:
//
//   - No wallet  → free preview (top-1 coin, proves the feed is live).
//   - With wallet → full ranked candidate list (20 coins), auto-paying $0.004/call
//                   in USDC on Base via x402 (EIP-3009 gasless — no API key, no gas ETH).
//
//   npm i x402-fetch viem
//   node examples/funding-arb-scanner.mjs                           # free preview only
//   EVM_PRIVATE_KEY=0xYOURKEY node examples/funding-arb-scanner.mjs  # full ranked scan (pays $0.004)
//
// HONEST: this is a SCANNER, not financial advice and not a profit guarantee. The
// arb ranking is naive — it ranks by raw funding spread and excludes trading fees,
// slippage, margin, and execution/latency timing. Treat the output as a candidate
// list to investigate, bring your own wallet, bring your own risk. The private key
// is a normal Base EOA holding a little USDC; nothing leaves your machine except the
// signed EIP-3009 authorization the x402 facilitator submits on-chain.

const BASE = process.env.X402_BASE_URL || "https://x402-data-api.sigrunner.workers.dev";
const LIMIT = Number(process.env.LIMIT || 20);
const key = (process.env.EVM_PRIVATE_KEY || "").trim();
const HAS_KEY = /^0x[0-9a-fA-F]{64}$/.test(key);

async function makePayFetch() {
  const { createWalletClient, http } = await import("viem");
  const { base } = await import("viem/chains");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { wrapFetchWithPayment } = await import("x402-fetch");
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: base, transport: http() });
  // wrapFetchWithPayment(fetch, walletClient) — 2nd arg is a viem WalletClient, not a bare account.
  return { f: wrapFetchWithPayment(fetch, wallet), payer: account.address };
}

async function getJson(fn, path) {
  const r = await fn(`${BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return r.json();
}

function printRow(c) {
  const spread = (c.funding_spread_bps ?? 0).toFixed(2).padStart(7);
  const coin = String(c.coin).padEnd(6);
  const sig = String(c.signal || "").padEnd(11);
  console.log(
    `  ${coin} spread=${spread} bps  long@${String(c.best_long_venue).padEnd(10)} short@${String(c.best_short_venue).padEnd(5)} ${sig} OI=${c.openInterest ?? "-"}`
  );
}

async function main() {
  console.log(`\n=== Grey Ridge funding-arb scanner → ${BASE} ===`);
  console.log(
    HAS_KEY
      ? "x402 wallet: configured — paid full scan enabled (auto-pays $0.004 USDC on Base).\n"
      : "x402 wallet: none — free preview only. Set EVM_PRIVATE_KEY for the full ranked scan.\n"
  );

  // 1) Free preview — no wallet needed. Proves the feed is live.
  try {
    const p = await getJson(fetch, "/crypto/funding/preview");
    const top = (p.preview || [])[0];
    if (top) {
      console.log("Free preview (no payment) — widest single sample:");
      printRow(top);
      console.log(`  (${p.total_available} coins available in the full paid scan)\n`);
    }
  } catch (e) {
    console.log("Free preview unavailable:", e.message, "\n");
  }

  if (!HAS_KEY) {
    console.log("→ Set EVM_PRIVATE_KEY (a Base EOA holding a little USDC) and re-run for the full");
    console.log(`  ranked candidate list:  GET ${BASE}/crypto/funding?limit=${LIMIT}  ($0.004/call)\n`);
    return;
  }

  // 2) Paid full scan — auto-pays via x402.
  const { f, payer } = await makePayFetch();
  console.log(`→ paying + fetching /crypto/funding?limit=${LIMIT}  (payer ${payer})`);
  const data = await getJson(f, `/crypto/funding?limit=${LIMIT}`);
  const rows = Array.isArray(data) ? data : data.funding || data.data || [];
  const ranked = [...rows].sort(
    (a, b) => Math.abs(b.funding_spread_bps ?? 0) - Math.abs(a.funding_spread_bps ?? 0)
  );
  console.log(`\nTop cross-venue funding-arb candidates (by |spread|, naive — excludes fees/slippage):\n`);
  ranked.slice(0, LIMIT).forEach(printRow);
  console.log(
    `\nNOT financial advice. Candidates only — validate fees, margin, borrow and execution before acting.\n`
  );
}

main().catch((e) => {
  console.error("scanner failed:", e.message);
  process.exit(1);
});
