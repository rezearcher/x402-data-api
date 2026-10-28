#!/usr/bin/env node
/**
 * settle_once.js — submit EXACTLY ONE paid settlement through the CDP facilitator.
 *
 * WHY: the Bazaar catalog only refreshes (lastCalledAt / lastUpdated / stored
 * description snapshot) when a payment settles THROUGH the CDP facilitator.
 * This is the one-shot, auditable executor for that single call — written for
 * kanban card t_6503d66f, where "exactly one call" is a hard fraud/ledger
 * guardrail. It is deliberately NOT a loop and has no batch mode.
 *
 * DIFFERENCE FROM refresh_bazaar_catalog.js: that script logs only
 * `verify=<status> settle=<status>`. The proof of a listing refresh is
 * settle.extensionResponses containing `success` (a `rejected` extension still
 * moves USDC and indexes nothing), so this script captures and journals the
 * full relay response: tx hash, extensionResponses, timestamps, route, and the
 * pre/post USDC balance delta.
 *
 * HARD GUARDS (any failure = no POST):
 *   - the INSERT-only settlement ledger already holds an entry for the route
 *     inside --guard-window-days (default 25) => refuse. See "IDEMPOTENCY" below.
 *   - live 402 amount != --expect-units (default 9000 = 0.009 USDC) => refuse
 *   - live 402 amount > --cap (default 0.01 USDC) => refuse
 *   - payTo is not ours / asset is not Base USDC / network is not eip155:8453 => refuse
 *   - description > 500 chars or missing the buyer vocabulary => refuse
 *   - buyer wallet lacks balance for quote + floor => refuse
 *   - RAPIDAPI_PROXY_SECRET / CDP_INTERNAL_SECRET absent => refuse
 *
 * IDEMPOTENCY (fixed 2026-10-28, card t_4ed8918e):
 *   The guard used to grep logs/cdp-settlement-tx.log for `settlement_confirmed`.
 *   That log is the *evidence* file, so archiving it to preserve evidence silently
 *   disabled the guard — and because the same log was rewritten each run, it also
 *   let a second settlement run on a one-call card (tx 0xc2e023e9 replaced tx
 *   0x51bcdd08's three lines; git diff 3 deletions / 2 insertions). The guard now
 *   asks the INSERT-only, sha256-chained ledger via
 *   `scripts/cdp_settlement_ledger.py guard`, and refuses when it cannot prove the
 *   route is unsettled (missing ledger, unreadable ledger, broken chain = refuse).
 *   On success the run appends its own ledger entry, so "settled but unledgered"
 *   cannot happen silently.
 *
 *   logs/cdp-settlement-tx.log is now an APPEND-ONLY convenience journal
 *   (fs.appendFileSync with flags:'a'). Never truncate it, never rewrite it to
 *   "clean it up": it is one of two evidence copies, and the ledger is the record
 *   of record.
 *
 * REVENUE EXCLUSION: payer = buyer-wallet, payee = our PAY_TO. Both are
 * SELF_ADDRS (scripts/verify_revenue_ledger.py) / SELF_PAYERS (src/index.ts), so
 * any resulting row classifies self_traffic and never counts as revenue. The
 * relay writes no ledger row at all.
 *
 * Usage:
 *   RAPIDAPI_PROXY_SECRET=... node scripts/settle_once.js [--route /chain/token-security]
 *        [--cap 0.01] [--expect-units 9000] [--guard-window-days 25] [--purpose "..."] [--force] [--dry-run]
 *
 * Exit: 0 = settled + ledgered + `settlement_confirmed` journaled;
 *       1 = refused/failed (nothing spent on refusal);
 *       2 = already settled per the ledger (idempotent no-op);
 *       3 = SETTLED BUT UNLEDGERED — money moved and the ledger append failed. Recover
 *           from the .pending-unledgered-*.json file before doing anything else.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const BASE = 'https://x402-data-api.sigrunner.workers.dev';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const OUR_PAYTO = '0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10';
// APPEND-ONLY evidence journal. Every write goes through appendFileSync with
// flags:'a'. Nothing in this file may truncate, rewrite, or rotate it away — the
// 06:02Z settlement lost its three lines to a rewrite on 2026-10-28 and that is
// exactly the failure this comment exists to prevent.
const LOG_PATH = path.join(projectDir, 'logs/cdp-settlement-tx.log');
const LOG_APPEND = { flags: 'a', encoding: 'utf8' };
const LEDGER_DIR = path.join(projectDir, 'ledger');
// The idempotency key. Never a log file, never a cooldown file: only the ledger.
const LEDGER_CLI = path.join(projectDir, 'scripts/cdp_settlement_ledger.py');
const COOLDOWN_PATH = path.join(projectDir, 'scripts/.bazaar_refresh_cooldown.json');
const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const ROUTE = arg('route', '/chain/token-security');
const CAP_USDC = Number(arg('cap', '0.01'));
const EXPECT_UNITS = arg('expect-units', '9000');
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force'); // bypass cooldown only, NEVER the ledger guard
// Re-listing validity window: the catalogue claims a 30-day freshness cliff and the
// monitor fires at 25 days, so a route settled inside 25 days must not be re-settled.
// The flag may only WIDEN this window, never shrink it — a guard you can shorten with a
// one-word flag is not a guard. NaN (typo'd arg) falls back to the floor.
const GUARD_WINDOW_DAYS = (() => {
  const n = Number(arg('guard-window-days', '25'));
  return Number.isFinite(n) ? Math.max(25, n) : 25;
})();
const PURPOSE = arg('purpose', 're-list / refresh route via settle_once.js');
const CARD = arg('card', null);

// Route metadata. Mirrors the /chain/token-security entry in
// scripts/refresh_bazaar_catalog.js — the settlement snapshots whatever these
// strings say, so this is the publish payload. 393 chars, leads with the buyer's
// question, carries the buyer vocabulary the missed queries actually used
// (`scam`, `honeypot`, `rug-pull`).
const ROUTE_META = {
  route: '/chain/token-security',
  desc: 'Is this Base token a scam or rug pull? Honeypot detector for a Base ERC-20: EIP-1967 proxy + upgradeability check, bytecode scan for mint/pause/blacklist/fee-setter/ownership, owner() renouncement, and a live eth_call state-override sim proving a real wallet can transfer() it. Returns risk_score (0-100) + verdict (clear/review/block) + honeypot/scam/rug flags. Use before an agent buys, holds or approves a token.',
  serviceName: 'Base Token Safety & Honeypot Scanner',
  tags: ['token-safety', 'token-security', 'honeypot', 'rug-check', 'scam-check', 'pre-trade', 'base', 'evm', 'smart-contract', 'security'],
  disc: {
    method: 'GET',
    input: { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string', description: '0x-prefixed 20-byte ERC-20 contract address on Base mainnet' } },
    },
    output: {
      example: {
        token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chain: 'base', is_contract: true,
        proxy: { is_proxy: true, proxy_standard: 'OZ zOS AdminUpgradeabilityProxy (pre-EIP-1967)', is_upgradeable: true },
        capabilities: { can_mint: true, can_burn: true, can_pause: true, has_blacklist: true },
        risk_score: 65, verdict: 'review',
        risk_summary: '5 risk flag(s) detected. Risk 65/100.',
      },
    },
  },
};

function journal(obj) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  // flags:'a' — APPEND ONLY. Never writeFileSync here.
  fs.appendFileSync(LOG_PATH, JSON.stringify(obj) + '\n', LOG_APPEND);
}
function refuse(msg, code) {
  console.error('REFUSED: ' + msg);
  journal({ event: 'settlement_refused', route: ROUTE, timestamp: new Date().toISOString(), reason: msg, spent_usdc: 0 });
  process.exit(code || 1);
}

// ---- idempotency guard, keyed on the INSERT-only ledger ---------------------
// Deliberately shells out to the Python ledger tool instead of re-implementing the
// sha256 chain in JS: one verifier, one canonicalisation, no drift.
// Fail-closed contract — only an explicit exit 0 lets this run proceed:
//   0 => clear       2 => already settled (refuse)       anything else => refuse
function ledgerGuard() {
  if (!fs.existsSync(LEDGER_CLI)) {
    refuse(`ledger tool missing at ${LEDGER_CLI} — cannot prove this route is unsettled (fail closed)`);
  }
  const r = spawnSync(
    'python3',
    [LEDGER_CLI, 'guard', '--route', ROUTE, '--window-days', String(GUARD_WINDOW_DAYS)],
    { encoding: 'utf8', timeout: 60000 }
  );
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (out) console.log(out);
  if (r.error) refuse(`ledger guard could not execute (${r.error.message}) — fail closed`);
  if (r.status === 2) {
    console.error(`ALREADY SETTLED: the ledger already holds an entry for ${ROUTE} inside ${GUARD_WINDOW_DAYS}d.`);
    console.error('This route is not re-settled: a repeat settlement is the 1-payer wash pattern and it spends real USDC.');
    console.error('If a re-publish is genuinely required, raise --guard-window-days deliberately and record why in --purpose.');
    process.exit(2);
  }
  if (r.status !== 0) {
    refuse(`ledger guard returned exit ${r.status} (not 0, not 2) — fail closed rather than spend blind`);
  }
}

// ---- ledger write-up on success --------------------------------------------
function ledgerAppend(file, entry) {
  return spawnSync('python3', [LEDGER_CLI, 'append', '--file', file, '--entry', '-'], {
    input: JSON.stringify(entry),
    encoding: 'utf8',
    timeout: 60000,
  });
}

function decodeExt(raw) {
  if (!raw) return null;
  for (const attempt of [() => JSON.parse(raw), () => JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))]) {
    try { return attempt(); } catch { /* next */ }
  }
  try { return JSON.parse(decodeURIComponent(raw)); } catch { /* fall through */ }
  return raw;
}

(async () => {
  // ---- guard 1: idempotency, keyed on the INSERT-only ledger ----
  // (was: grep logs/cdp-settlement-tx.log for `settlement_confirmed` — the evidence
  // file doubled as the guard key, so archiving evidence disabled the guard)
  ledgerGuard();

  // ---- guard: auth secret present ----
  const headerName = process.env.CDP_INTERNAL_SECRET ? 'X-CDP-Internal-Secret' : 'X-RapidAPI-Proxy-Secret';
  const secret = process.env.CDP_INTERNAL_SECRET || process.env.RAPIDAPI_PROXY_SECRET;
  if (!secret) refuse('neither CDP_INTERNAL_SECRET nor RAPIDAPI_PROXY_SECRET is set (the relay fails closed, every settle would 401)');

  // ---- guard: cooldown ----
  let cooldowns = {};
  try { cooldowns = JSON.parse(fs.readFileSync(COOLDOWN_PATH, 'utf8')); } catch { /* none */ }
  const last = cooldowns[ROUTE];
  const COOLDOWN_MS = 20 * 60 * 60 * 1000;
  if (!FORCE && last && Date.now() - last < COOLDOWN_MS) {
    refuse(`route ${ROUTE} inside 20h cooldown (until ${new Date(last + COOLDOWN_MS).toISOString()}); pass --force only with intent`);
  }

  // ---- guard: publish payload sanity (the settlement snapshots these) ----
  if (ROUTE_META.desc.length > 500) refuse(`description is ${ROUTE_META.desc.length} chars (>500 catalog limit)`);
  if (!/\bscam\b/i.test(ROUTE_META.desc)) refuse('description lost the buyer vocabulary ("scam") the missed queries used');

  const viem = require(path.join(projectDir, 'node_modules/viem'));
  const viemAccounts = require(path.join(projectDir, 'node_modules/viem/accounts'));
  const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));
  const { toClientEvmSigner } = require(path.join(projectDir, 'node_modules/@x402/evm'));
  const { registerExactEvmScheme } = require(path.join(projectDir, 'node_modules/@x402/evm/dist/cjs/exact/client/index.js'));
  const { x402Client } = require(path.join(projectDir, 'node_modules/@x402/core/dist/cjs/client/index.js'));
  const { declareDiscoveryExtension } = require(path.join(projectDir, 'node_modules/@x402/extensions/dist/cjs/bazaar/index.js'));

  const wallet = JSON.parse(fs.readFileSync(path.join(projectDir, 'buyer-wallet.json'), 'utf8'));
  const account = viemAccounts.privateKeyToAccount(wallet.privateKey);
  const walletClient = viem.createWalletClient({ account, chain: base, transport: viem.http(RPC) });
  const publicClient = viem.createPublicClient({ chain: base, transport: viem.http(RPC) });
  const evmClient = toClientEvmSigner({ ...walletClient, address: account.address }, publicClient);
  const coreClient = new x402Client();
  registerExactEvmScheme(coreClient, { signer: evmClient, networks: ['eip155:8453'] });

  const erc20 = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  ];
  const balBefore = async () => Number(await publicClient.readContract({ address: USDC_BASE, abi: erc20, functionName: 'balanceOf', args: [account.address] })) / 1e6;

  // ---- 1. live 402 challenge ----
  const resourceUrl = BASE + ROUTE;
  const probe = await fetch(resourceUrl, { headers: { accept: 'application/json' } });
  const hdr = probe.headers.get('payment-required');
  if (probe.status !== 402 || !hdr) refuse(`expected 402 + payment-required header, got http=${probe.status}`);
  const paymentRequired = JSON.parse(Buffer.from(hdr, 'base64').toString('utf8'));
  const a = (paymentRequired.accepts || [])[0] || {};
  const units = String(a.amount || a.maxAmountRequired || '0');
  const quotedUsdc = Number(units) / 1e6;

  if (units !== EXPECT_UNITS) refuse(`live quote is ${units} units (${quotedUsdc} USDC), expected ${EXPECT_UNITS} — price moved; re-authorise before spending`);
  if (quotedUsdc > CAP_USDC) refuse(`live quote ${quotedUsdc} USDC exceeds approved cap ${CAP_USDC} USDC`);
  if (String(a.asset).toLowerCase() !== USDC_BASE.toLowerCase()) refuse(`asset ${a.asset} is not Base USDC`);
  if (String(a.network) !== 'eip155:8453') refuse(`network ${a.network} is not eip155:8453`);
  if (String(a.payTo).toLowerCase() !== OUR_PAYTO.toLowerCase()) refuse(`payTo ${a.payTo} is not our payTo`);

  const balanceBefore = await balBefore();
  if (balanceBefore < quotedUsdc + 0.002) refuse(`buyer balance ${balanceBefore} USDC cannot cover ${quotedUsdc} + 0.002 floor`);
  const blockBefore = Number(await publicClient.getBlockNumber());

  console.log(`route      ${ROUTE}`);
  console.log(`quote      ${quotedUsdc} USDC (${units} units) -> ${a.payTo}`);
  console.log(`buyer      ${account.address} balance ${balanceBefore} USDC (block ${blockBefore})`);
  console.log(`desc       ${ROUTE_META.desc.length} chars, buyer vocabulary present`);
  console.log(`auth hdr   ${headerName}`);

  // ---- 2. sign the EIP-3009 exact payment (gasless for payer) ----
  const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);

  // ---- 3. bazaar discovery extension (same #2156 workaround as the seed/refresh scripts) ----
  const disc = declareDiscoveryExtension(ROUTE_META.disc);
  const bazaar = disc.bazaar || disc;
  bazaar.info = bazaar.info || {};
  bazaar.info.input = bazaar.info.input || {};
  bazaar.info.input.type = 'http';
  bazaar.info.input.method = 'GET';
  bazaar.routeTemplate = ROUTE_META.route;
  paymentPayload.extensions = { ...(paymentPayload.extensions || {}), bazaar };
  paymentPayload.resource = {
    url: resourceUrl,
    resource: resourceUrl,
    description: ROUTE_META.desc,
    mimeType: 'application/json',
    serviceName: ROUTE_META.serviceName,
    tags: ROUTE_META.tags,
  };

  // ---- 4. flat v2 paymentRequirements ----
  const paymentRequirements = {
    scheme: a.scheme,
    network: a.network,
    amount: units,
    resource: paymentRequired.resource?.url || resourceUrl,
    description: ROUTE_META.desc,
    mimeType: 'application/json',
    payTo: a.payTo,
    maxTimeoutSeconds: a.maxTimeoutSeconds || 300,
    asset: a.asset,
    extra: a.extra,
    serviceName: ROUTE_META.serviceName,
    tags: ROUTE_META.tags,
    extensions: { bazaar },
  };

  if (DRY) {
    console.log('\nDRY RUN — payload built, no settle POST issued.');
    console.log('payload.from =', paymentPayload?.payload?.authorization?.from);
    console.log('auth.to/value =', paymentPayload?.payload?.authorization?.to, paymentPayload?.payload?.authorization?.value);
    console.log('sig len =', (paymentPayload?.payload?.signature || '').length);
    process.exit(0);
  }

  // ---- 5. THE single settle call ----
  const sentAt = new Date().toISOString();
  const settleRes = await fetch(`${BASE}/internal/cdp-settle-raw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [headerName]: secret },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  const settleOut = await settleRes.json().catch(() => ({ parse_error: true }));
  const receivedAt = new Date().toISOString();

  const settle = settleOut.settle || null;
  const verify = settleOut.verify || null;
  const extRaw = settle?.extensionResponses || null;
  const extDecoded = decodeExt(extRaw);
  const extStr = typeof extDecoded === 'string' ? extDecoded : JSON.stringify(extDecoded);
  // EXTENSION-RESPONSES per-extension status is success | processing | rejected
  // (docs/findings/cdp-settlement-flow.md:57). `rejected` is the failure case: USDC
  // still moves and NOTHING is indexed. `processing` means the bazaar extension was
  // accepted and the index write is asynchronous — a real (not failed) settlement.
  const extRejected = /"status"\s*:\s*"rejected"|\brejected\b/i.test(extStr || '');
  const extProcessing = /"status"\s*:\s*"processing"|\bprocessing\b/i.test(extStr || '');
  const extOk = !extRejected && (/"status"\s*:\s*"success"|"success"\s*:\s*true|\bsuccess\b/i.test(extStr || '') || extProcessing);

  let settleBody = null;
  try { settleBody = JSON.parse(settle?.body || 'null'); } catch { settleBody = settle?.body ?? null; }
  const txHash =
    settleBody?.transaction || settleBody?.txHash || settleBody?.tx_hash ||
    settleBody?.settlement?.transaction || null;
  const payer = settleBody?.payer || paymentPayload?.payload?.authorization?.from || null;

  // Post-spend balance: USDC moves on-chain; give the RPC a moment.
  let balanceAfter = null;
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const b = await balBefore();
    if (b !== balanceBefore) { balanceAfter = b; break; }
    balanceAfter = b;
  }
  const spent = Number((balanceBefore - (balanceAfter ?? balanceBefore)).toFixed(6));

  const proof = {
    event: 'settlement_attempt',
    route: ROUTE,
    resource_url: resourceUrl,
    sent_at: sentAt,
    received_at: receivedAt,
    relay_http: settleRes.status,
    verify_status: verify?.status ?? null,
    settle_status: settle?.status ?? null,
    settle_body: settleBody,
    tx_hash: txHash,
    payer,
    payee: a.payTo,
    extension_responses_raw: extRaw,
    extension_responses: extDecoded,
    extension_success: extOk,
    quoted_usdc: quotedUsdc,
    spent_usdc: spent,
    balance_before_usdc: balanceBefore,
    balance_after_usdc: balanceAfter,
    deviation_flag: spent > CAP_USDC,
    description_published: ROUTE_META.desc,
    description_chars: ROUTE_META.desc.length,
    auth_header_used: headerName,
    expected_units: EXPECT_UNITS,
    cap_usdc: CAP_USDC,
  };
  journal(proof);

  console.log('\n──── relay response ────');
  console.log(`relay http        ${settleRes.status}`);
  console.log(`verify status     ${verify?.status}`);
  console.log(`settle status     ${settle?.status}`);
  console.log(`tx hash           ${txHash}`);
  console.log(`extensionResponses ${extStr}`);
  console.log(`extension success  ${extOk}`);
  console.log(`spent             ${spent} USDC (cap ${CAP_USDC})`);

  const confirmed = verify?.status === 200 && settle?.status === 200 && extOk && !!txHash;
  if (!confirmed) {
    journal({ event: 'settlement_unconfirmed', route: ROUTE, timestamp: receivedAt, reason: 'missing verify==200 || settle==200 || extension success || tx hash', detail: proof });
    console.error('\nNOT CONFIRMED — no settlement_confirmed line written. Do NOT retry blind: inspect the relay body above first.');
    process.exit(1);
  }

  // ---- 6. durable write-up: the ledger entry (settled => ledgered, by construction) ----
  // The ledger is the guard's key, so a settlement that is not in it silently re-arms
  // the guard. Write it FIRST, retry once, and if it still fails make that loud and
  // recoverable instead of quietly leaving an unguarded settlement behind.
  const ledgerFile = path.join(LEDGER_DIR, `cdp-settlement-${receivedAt.slice(0, 10)}.json`);
  const extensionStatus = extRejected ? 'rejected' : extProcessing ? 'processing' : 'success';
  const ledgerEntry = {
    tx_hash: txHash,
    amount_usdc: quotedUsdc,
    amount_units: Number(units),
    endpoint: { route: ROUTE, url: resourceUrl, method: 'GET', host: new URL(resourceUrl).host },
    settled_at: receivedAt,
    // Placeholder by design: re-listing is MEASURED afterwards (index lag has been
    // observed at 4 s and at ~75 min), never assumed at settle time. It is resolved by
    // appending a follow-up measurement entry — never by editing this one: the ledger is
    // INSERT-only and hash-chained, so an edit breaks `verify` for every later entry.
    re_listing: {
      verdict: 'PENDING — not yet measured',
      measured_at: null,
      measure_with: 'python3 scripts/check_rediscovery_verdict.py --since <settled_at>, at +15 min and +2 h',
      resolve_by: 'append a follow-up measurement entry for this tx_hash (do not edit this entry)',
    },
    extension_status: extensionStatus,
    facilitator: 'CDP /platform/v2/x402/settle (verify-then-settle), relay /internal/cdp-settle-raw',
    purpose: PURPOSE,
    ...(CARD ? { card: CARD } : {}),
    evidence_source: 'logs/cdp-settlement-tx.log (append-only journal) + facilitator relay response',
    evidence_tier: 'on-chain receipt + facilitator relay response',
    balance_before_usdc: balanceBefore,
    balance_after_usdc: balanceAfter,
    payer,
    payee: a.payTo,
    description_published_chars: ROUTE_META.desc.length,
    revenue_recognized_usdc: 0.0,
  };

  let ledgerSeq = null;
  let ledgerErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = ledgerAppend(ledgerFile, ledgerEntry);
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    if (out) console.log(out);
    // "already in the ledger" is the desired end state (crash-and-rerun), not a failure.
    if (r.status === 0 || /already in the ledger/i.test(out)) {
      const m = /seq=(\d+)/.exec(out);
      ledgerSeq = m ? Number(m[1]) : null;
      ledgerErr = null;
      break;
    }
    ledgerErr = r.error ? r.error.message : `exit ${r.status}: ${out.split('\n')[0]}`;
    if (attempt === 0) await new Promise((res) => setTimeout(res, 1500));
  }

  if (ledgerErr) {
    const pendingPath = path.join(LEDGER_DIR, `.pending-unledgered-${txHash}.json`);
    try {
      fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
      fs.writeFileSync(pendingPath, JSON.stringify({ entry: ledgerEntry, error: ledgerErr }, null, 2), { flag: 'wx' });
    } catch { /* best effort: the journal line below is the other copy */ }
    journal({
      event: 'settlement_unledgered',
      route: ROUTE,
      timestamp: receivedAt,
      tx_hash: txHash,
      spent_usdc: spent,
      error: ledgerErr,
      pending_entry_path: pendingPath,
    });
    console.error(`\nSETTLED BUT UNLEDGERED — tx ${txHash} moved ${spent} USDC and could NOT be written to ${ledgerFile}`);
    console.error(`reason: ${ledgerErr}`);
    console.error(`DO NOT re-run settle_once.js for ${ROUTE} until this entry is in the ledger (the guard cannot see it).`);
    console.error(`recover: python3 scripts/cdp_settlement_ledger.py append --file ${ledgerFile} --entry "$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1]))["entry"]))' ${pendingPath})"`);
    process.exit(3);
  }

  // cooldown + durable confirmation line
  cooldowns[ROUTE] = Date.now();
  try { fs.writeFileSync(COOLDOWN_PATH, JSON.stringify(cooldowns, null, 2)); } catch { /* non-fatal */ }

  const line = `settlement_confirmed route=${ROUTE} tx=${txHash} ts=${receivedAt} units=${units} usdc=${quotedUsdc} extension=${extensionStatus} spent_usdc=${spent} ledger=${path.basename(ledgerFile)}#${ledgerSeq}`;
  fs.appendFileSync(LOG_PATH, line + '\n', LOG_APPEND);
  console.log('\n' + line);
  console.log(`logged to ${LOG_PATH}`);
})().catch((e) => {
  console.error('SETTLE ERROR:', e.message);
  journal({ event: 'settlement_error', route: ROUTE, timestamp: new Date().toISOString(), error: e.message });
  process.exit(1);
});
