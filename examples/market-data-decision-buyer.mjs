// Grey Ridge x402 — agentic market-data buyer with budget + freshness gates.
//
// This is the example an *agent framework* needs (the Decision402 archetype:
// "let a user ask for a price, buy it from a real x402 service, and never present
// outdated data as real-time"). Unlike examples/buyer.mjs (which just pays), this
// one runs the full decision loop an autonomous buyer should run BEFORE and AFTER
// paying:
//
//   1. DISCOVER   — read the live HTTP 402 quote to learn price/asset/network
//                   up front (no payment, no wallet needed).
//   2. BUDGET     — refuse to pay if the quoted price exceeds your per-call cap.
//   3. PREVIEW    — hit the free preview path to prove the feed is live first.
//   4. PAY        — settle USDC on Base inline via x402 (EIP-3009 gasless).
//   5. FRESHNESS  — parse the returned `timestamp` and REJECT data older than
//                   MAX_AGE_SECONDS instead of presenting stale as real-time.
//   6. REPORT     — print price, currency, source, update time, amount paid,
//                   and payment result in one structured record.
//
//   npm i x402-fetch viem
//   # Step 1-3 run with no wallet (discovery + budget + preview):
//   node examples/market-data-decision-buyer.mjs bitcoin,ethereum
//   # Full paid loop (pays $0.001 USDC on Base):
//   EVM_PRIVATE_KEY=0xYOURKEY node examples/market-data-decision-buyer.mjs bitcoin,ethereum
//
// Tunables (env): MAX_USDC (per-call budget, default 0.01), MAX_AGE_SECONDS
// (freshness cap, default 300). The private key is a normal Base EOA holding a
// little USDC; nothing leaves your side except the signed EIP-3009 authorization.
//
// Deps are imported lazily, so steps 1-3 (discover/budget/preview) run with ZERO
// npm installs — you only need `npm i x402-fetch viem` to run the paid step.

const BASE = process.env.X402_BASE_URL || "https://x402-data-api.sigrunner.workers.dev";
const COINS = process.argv[2] || "bitcoin,ethereum,solana";
const MAX_USDC = Number(process.env.MAX_USDC || "0.01");
const MAX_AGE_SECONDS = Number(process.env.MAX_AGE_SECONDS || "300");
const SOURCE = "Grey Ridge Signals /crypto/prices (DefiLlama)";
const url = `${BASE}/crypto/prices?coins=${encodeURIComponent(COINS)}`;

const fail = (msg) => { console.error(`✗ REJECTED: ${msg}`); process.exit(2); };

// ── 1. DISCOVER: read the live 402 quote before paying ──────────────────────
const q = await fetch(url);
if (q.status !== 402) fail(`expected a 402 quote, got HTTP ${q.status}`);
const quote = await q.json();
const accept = quote?.accepts?.[0];
if (!accept) fail("402 body had no accepts[] offer to evaluate");
const decimals = Number(accept?.extra?.decimals ?? 6);
const priceUsdc = Number(accept.amount) / 10 ** decimals;
console.error(`→ quote: ${priceUsdc} USDC on ${accept.network} (asset ${accept.asset}), scheme ${accept.scheme}`);

// ── 2. BUDGET GATE: refuse if the quote is over cap ─────────────────────────
if (priceUsdc > MAX_USDC) fail(`quoted ${priceUsdc} USDC > budget ${MAX_USDC} USDC`);
console.error(`✓ budget ok (${priceUsdc} <= ${MAX_USDC} USDC)`);

// ── 3. PREVIEW: prove the feed is live for free before spending ─────────────
const prev = await fetch(`${BASE}/crypto/prices/preview?coins=${encodeURIComponent(COINS.split(",")[0])}`);
if (!prev.ok) fail(`free preview unhealthy (HTTP ${prev.status}) — not paying a dead feed`);
console.error(`✓ preview live (free sample ok)`);

// ── 4. PAY: settle USDC on Base inline (needs a funded EOA) ──────────────────
const key = process.env.EVM_PRIVATE_KEY;
if (!key) {
  console.error("\nDiscovery + budget + preview all passed. Set EVM_PRIVATE_KEY (a 0x Base EOA holding USDC) to run the paid call.");
  process.exit(0);
}
const { createWalletClient, http } = await import("viem");
const { privateKeyToAccount } = await import("viem/accounts");
const { base } = await import("viem/chains");
const { wrapFetchWithPayment } = await import("x402-fetch");
const account = privateKeyToAccount(key);
const walletClient = createWalletClient({ account, chain: base, transport: http() });
const payFetch = wrapFetchWithPayment(fetch, walletClient);
console.error(`→ paying ${priceUsdc} USDC + fetching (payer ${account.address})`);
const r = await payFetch(url);
if (!r.ok) fail(`paid call returned HTTP ${r.status}`);
const rows = await r.json();

// decode the settlement receipt the facilitator returns
let receipt = null;
const hdr = r.headers.get("x-payment-response");
if (hdr) { try { receipt = JSON.parse(Buffer.from(hdr, "base64").toString("utf8")); } catch {} }

// ── 5. FRESHNESS GATE: reject stale data instead of showing it as real-time ──
const now = Math.floor(Date.now() / 1000);
const data = Array.isArray(rows) ? rows : (rows?.prices || rows?.data || []);
if (!data.length) fail("paid response had no price rows");
for (const row of data) {
  const age = now - Number(row.timestamp);
  if (!Number.isFinite(age)) fail(`row ${row.id} has no usable timestamp`);
  if (age > MAX_AGE_SECONDS) fail(`${row.symbol} price is ${age}s old > MAX_AGE_SECONDS ${MAX_AGE_SECONDS} — refusing to present as real-time`);
}

// ── 6. REPORT: one structured decision record ────────────────────────────────
console.error(`✓ paid + fresh (${receipt?.success ? "settled" : "paid"})`);
console.log(JSON.stringify({
  source: SOURCE,
  currency: "USD",
  amount_paid_usdc: priceUsdc,
  network: accept.network,
  payment_result: receipt ? { success: receipt.success, tx: receipt.transaction, payer: receipt.payer, network: receipt.network } : "paid (no receipt header)",
  as_of: data.map((d) => ({ symbol: d.symbol, price_usd: d.price, change_24h: d.change_24h, confidence: d.confidence, update_time: new Date(Number(d.timestamp) * 1000).toISOString(), age_seconds: now - Number(d.timestamp) })),
}, null, 2));
