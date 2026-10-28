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
 *   - logs/cdp-settlement-tx.log already contains `settlement_confirmed` => refuse
 *   - live 402 amount != --expect-units (default 9000 = 0.009 USDC) => refuse
 *   - live 402 amount > --cap (default 0.01 USDC) => refuse
 *   - payTo is not ours / asset is not Base USDC / network is not eip155:8453 => refuse
 *   - description > 500 chars or missing the buyer vocabulary => refuse
 *   - buyer wallet lacks balance for quote + floor => refuse
 *   - RAPIDAPI_PROXY_SECRET / CDP_INTERNAL_SECRET absent => refuse
 *
 * REVENUE EXCLUSION: payer = buyer-wallet, payee = our PAY_TO. Both are
 * SELF_ADDRS (scripts/verify_revenue_ledger.py) / SELF_PAYERS (src/index.ts), so
 * any resulting row classifies self_traffic and never counts as revenue. The
 * relay writes no ledger row at all.
 *
 * Usage:
 *   RAPIDAPI_PROXY_SECRET=... node scripts/settle_once.js [--route /chain/token-security]
 *        [--cap 0.01] [--expect-units 9000] [--force] [--dry-run]
 *
 * Exit: 0 = settled + `settlement_confirmed` logged; 1 = refused/failed (nothing
 * spent on refusal); 2 = already settled (idempotent no-op).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const BASE = 'https://x402-data-api.sigrunner.workers.dev';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const OUR_PAYTO = '0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10';
const LOG_PATH = path.join(projectDir, 'logs/cdp-settlement-tx.log');
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
const FORCE = process.argv.includes('--force'); // bypass cooldown only, never the log guard

// Route metadata. Mirrors the /chain/token-security entry in
// scripts/refresh_bazaar_catalog.js — the settlement snapshots whatever these
// strings say, so this is the publish payload. 393 chars, leads with the buyer's
// question, carries the buyer vocabulary the missed queries actually used
// (`scam`, `honeypot`, `rug-pull`).
const ROUTE_META = {
  route: '/chain/token-security',
  desc: 'Is this Base token a honeypot or rug-pull / scam risk? Token safety & security scan for a Base ERC-20: honeypot & sellability simulation, proxy/upgradeability check, mint/pause/blacklist/fee-setter bytecode scan, ownership-renounced check, measured transfer tax. Returns a 0-100 risk score, verdict and flags. A pre-trade token safety check for agents before buying or approving a Base ERC-20.',
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
  fs.appendFileSync(LOG_PATH, JSON.stringify(obj) + '\n');
}
function refuse(msg, code) {
  console.error('REFUSED: ' + msg);
  journal({ event: 'settlement_refused', route: ROUTE, timestamp: new Date().toISOString(), reason: msg, spent_usdc: 0 });
  process.exit(code || 1);
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
  // ---- guard: exactly one settlement, ever ----
  if (fs.existsSync(LOG_PATH) && fs.readFileSync(LOG_PATH, 'utf8').includes('settlement_confirmed')) {
    console.error('ALREADY SETTLED: logs/cdp-settlement-tx.log contains settlement_confirmed — this card allows one call.');
    process.exit(2);
  }

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

  // cooldown + durable confirmation line
  cooldowns[ROUTE] = Date.now();
  try { fs.writeFileSync(COOLDOWN_PATH, JSON.stringify(cooldowns, null, 2)); } catch { /* non-fatal */ }

  const line = `settlement_confirmed route=${ROUTE} tx=${txHash} ts=${receivedAt} units=${units} usdc=${quotedUsdc} extension=success spent_usdc=${spent}`;
  fs.appendFileSync(LOG_PATH, line + '\n');
  console.log('\n' + line);
  console.log(`logged to ${LOG_PATH}`);
})().catch((e) => {
  console.error('SETTLE ERROR:', e.message);
  journal({ event: 'settlement_error', route: ROUTE, timestamp: new Date().toISOString(), error: e.message });
  process.exit(1);
});
