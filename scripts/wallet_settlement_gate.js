#!/usr/bin/env node
/**
 * wallet_settlement_gate.js — pre-spend gate for the buyer wallet.
 *
 * WHY: a settlement is a capital spend. Before any call goes out, we want one
 * artifact that proves, empirically and on live state: the key we hold is the
 * key for the funded address, the balance covers the quoted 402 amount with
 * headroom, and the EIP-3009 payment payload the x402 client would submit is
 * signed by that funded address. This script performs EVERY step of the
 * settlement path except the final settle POST — it never spends.
 *
 * It is the gate that docs/wallet-settlement-ready.txt is written from.
 *
 * CHECKS (all must pass, exit 0):
 *   1. custody   buyer-wallet.json exists, mode 0600, gitignored, untracked in git
 *   2. identity  privateKey derives to the address recorded in the file
 *   3. funding   on-chain USDC balance >= --min (default 0.002)
 *   4. quote     live 402 challenge: asset is Base USDC, amount <= --cap (default 0.01)
 *   5. solvency  balance - amount >= --min (the spend leaves the wallet still gated)
 *   6. signer    x402 createPaymentPayload() signs from the funded address
 *
 * Usage:
 *   node scripts/wallet_settlement_gate.js [--route /chain/token-security]
 *                                          [--min 0.002] [--cap 0.01] [--json]
 *
 * Exit: 0 = all gates pass (safe to settle), 1 = at least one gate failed.
 * This script MUST NOT be extended to POST /internal/cdp-settle-raw.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const BASE = 'https://x402-data-api.sigrunner.workers.dev';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// --------------- args ---------------
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const ROUTE = arg('route', '/chain/token-security');
const MIN_USDC = Number(arg('min', '0.002'));
const CAP_USDC = Number(arg('cap', '0.01'));
const AS_JSON = process.argv.includes('--json');

const checks = [];
function check(id, ok, detail, extra) {
  checks.push({ id, ok: !!ok, detail, ...(extra ? { extra } : {}) });
  return ok;
}

(async () => {
  const viem = require(path.join(projectDir, 'node_modules/viem'));
  const viemAccounts = require(path.join(projectDir, 'node_modules/viem/accounts'));
  const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));
  const { toClientEvmSigner } = require(path.join(projectDir, 'node_modules/@x402/evm'));
  const { registerExactEvmScheme } = require(path.join(projectDir, 'node_modules/@x402/evm/dist/cjs/exact/client/index.js'));
  const { x402Client } = require(path.join(projectDir, 'node_modules/@x402/core/dist/cjs/client/index.js'));

  // ---- 1. custody ----
  const walletPath = path.join(projectDir, 'buyer-wallet.json');
  const exists = fs.existsSync(walletPath);
  if (!check('custody.file_present', exists, exists ? walletPath : 'buyer-wallet.json missing')) throw new Error('no wallet file');
  const mode = fs.statSync(walletPath).mode & 0o777;
  check('custody.mode_0600', mode === 0o600, 'mode=' + mode.toString(8));

  let ignored = false, tracked = false;
  try {
    execFileSync('git', ['check-ignore', '-q', 'buyer-wallet.json'], { cwd: projectDir });
    ignored = true;
  } catch { ignored = false; }
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', 'buyer-wallet.json'], { cwd: projectDir, stdio: 'ignore' });
    tracked = true;
  } catch { tracked = false; }
  check('custody.gitignored', ignored, 'git check-ignore');
  check('custody.not_tracked', !tracked, 'git ls-files');

  const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf8'));

  // ---- 2. identity: the key we hold is the key for the funded address ----
  const account = viemAccounts.privateKeyToAccount(wallet.privateKey);
  const addrMatch = account.address.toLowerCase() === String(wallet.address).toLowerCase();
  check('identity.key_matches_address', addrMatch,
    `file=${wallet.address} derived=${account.address}`);
  if (!addrMatch) throw new Error('holding a key for a different address than the funded one');

  // ---- live chain reads ----
  const publicClient = viem.createPublicClient({ chain: base, transport: viem.http(RPC) });
  const erc20 = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  ];
  const [raw, dec, ethBal, block] = await Promise.all([
    publicClient.readContract({ address: USDC_BASE, abi: erc20, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: USDC_BASE, abi: erc20, functionName: 'decimals' }),
    publicClient.getBalance({ address: account.address }),
    publicClient.getBlockNumber(),
  ]);
  const usdc = Number(raw) / 10 ** Number(dec);

  // ---- 3. funding ----
  check('funding.usdc_balance', usdc >= MIN_USDC,
    `balance=${usdc} USDC required>=${MIN_USDC}`, { usdc, min: MIN_USDC, raw: raw.toString(), decimals: Number(dec) });
  // Gas is not a requirement for EIP-3009 exact: the facilitator submits and pays gas.
  check('funding.eth_is_not_required', true, `eth=${Number(ethBal) / 1e18} (EIP-3009 -> facilitator pays gas)`);

  // ---- 4. quote from the live 402 challenge ----
  const resourceUrl = BASE + ROUTE;
  const probe = await fetch(resourceUrl, { headers: { accept: 'application/json' } });
  const hdr = probe.headers.get('payment-required');
  if (!check('quote.payment_required_header', probe.status === 402 && !!hdr, `http=${probe.status}`)) throw new Error('no 402 challenge');
  const paymentRequired = JSON.parse(Buffer.from(hdr, 'base64').toString());
  const a = (paymentRequired.accepts || [])[0] || {};
  const amountRaw = BigInt(a.amount || a.maxAmountRequired || '0');
  const amount = Number(amountRaw) / 10 ** Number(dec);
  check('quote.asset_is_base_usdc', String(a.asset).toLowerCase() === USDC_BASE.toLowerCase(), `asset=${a.asset}`);
  check('quote.network_is_base', String(a.network) === 'eip155:8453', `network=${a.network}`);
  check('quote.amount_within_cap', amount > 0 && amount <= CAP_USDC, `amount=${amount} cap<=${CAP_USDC}`, { amount, cap: CAP_USDC, units: amountRaw.toString() });
  check('quote.payee_is_our_payto', String(a.payTo).toLowerCase() === '0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10', `payTo=${a.payTo}`);

  // ---- 5. post-spend solvency: the spend must leave the wallet still gated ----
  const remaining = usdc - amount;
  check('solvency.post_spend_balance', remaining >= MIN_USDC,
    `remaining=${Number(remaining.toFixed(6))} required>=${MIN_USDC}`);

  // ---- 6. signer: the payload the x402 client WOULD submit ----
  const walletClient = viem.createWalletClient({ account, chain: base, transport: viem.http(RPC) });
  const evmClient = toClientEvmSigner({ ...walletClient, address: account.address }, publicClient);
  const coreClient = new x402Client();
  registerExactEvmScheme(coreClient, { signer: evmClient, networks: ['eip155:8453'] });
  const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);

  const payloadFrom =
    paymentPayload?.payload?.authorization?.from ||
    paymentPayload?.payload?.from ||
    paymentPayload?.from ||
    null;
  check('signer.payload_from_is_funded_wallet',
    !!payloadFrom && String(payloadFrom).toLowerCase() === account.address.toLowerCase(),
    `payload.from=${payloadFrom} funded=${account.address}`);
  const sig = paymentPayload?.payload?.signature || '';
  check('signer.eip3009_signature_present', /^0x[0-9a-fA-F]{130}$/.test(sig), `signature_len=${sig.length}`);
  const authTo = paymentPayload?.payload?.authorization?.to || null;
  const authValue = paymentPayload?.payload?.authorization?.value || null;
  check('signer.authorization_targets_payto',
    String(authTo).toLowerCase() === String(a.payTo).toLowerCase(),
    `authorization.to=${authTo} value=${authValue}`);
  if (authValue && String(authValue) !== amountRaw.toString()) {
    check('signer.authorization_value_matches_quote', false, `value=${authValue} quote=${amountRaw}`);
  }

  // Nonce validity window (EIP-3009 validAfter/validBefore) — informational + sanity.
  const now = Math.floor(Date.now() / 1000);
  const validAfter = Number(paymentPayload?.payload?.authorization?.validAfter || 0);
  const validBefore = Number(paymentPayload?.payload?.authorization?.validBefore || 0);
  check('signer.validity_window_current', validAfter <= now && now < validBefore,
    `validAfter=${validAfter} now=${now} validBefore=${validBefore} (${validBefore - now}s left)`);

  const ok = checks.every((c) => c.ok);
  const report = {
    gate: ok ? 'PASS' : 'FAIL',
    route: ROUTE,
    settled: false,
    spent_usdc: 0,
    wallet: { address: account.address, usdc, eth: Number(ethBal) / 1e18 },
    quote: { amount_usdc: amount, units: amountRaw.toString(), payTo: a.payTo, asset: a.asset, network: a.network },
    min_required_usdc: MIN_USDC,
    cap_usdc: CAP_USDC,
    post_spend_usdc: Number(remaining.toFixed(6)),
    block: Number(block),
    checked_at: new Date().toISOString(),
    checks,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== wallet settlement gate ===');
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(42)} ${c.detail}`);
    console.log('\nGATE:', report.gate, '| wallet', account.address, '| balance', usdc, 'USDC',
      '| quote', amount, 'USDC', '| post-spend', report.post_spend_usdc, 'USDC',
      '| block', Number(block), '| spent 0 (dry run)');
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('GATE ERROR:', e.message);
  process.exit(1);
});
