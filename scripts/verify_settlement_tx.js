#!/usr/bin/env node
/**
 * verify_settlement_tx.js — promote a settlement attempt to `settlement_confirmed`
 * on-chain proof, or refuse.
 *
 * WHY: `settle.extensionResponses` is the bazaar index signal, not the money
 * signal. A `rejected` extension still moves USDC; a `processing` extension means
 * the index write is queued. The only ground truth that the payer actually PAID
 * is the ERC-20 Transfer log in the settle transaction. This script reads the tx
 * hash captured in logs/cdp-settlement-tx.log, fetches the Base receipt, and only
 * appends `settlement_confirmed` when it finds exactly one USDC Transfer from the
 * buyer wallet to our payTo for exactly the quoted amount.
 *
 * Guarded so it cannot be used to paper over a failed spend:
 *   - exactly one settlement_attempt in the log (one call per card)
 *   - receipt status must be `success`
 *   - exactly one USDC Transfer to payTo, value must equal the quoted units
 *   - refuses if `settlement_confirmed` is already logged (idempotent)
 *
 * Usage: node scripts/verify_settlement_tx.js [--route /chain/token-security]
 * Exit: 0 = confirmed + appended; 1 = could not prove; 2 = already confirmed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const LOG_PATH = path.join(projectDir, 'logs/cdp-settlement-tx.log');
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const OUR_PAYTO = '0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const i = process.argv.indexOf('--route');
const ROUTE = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : '/chain/token-security';

if (!fs.existsSync(LOG_PATH)) {
  console.error('no settlement log at ' + LOG_PATH + ' — nothing to verify');
  process.exit(1);
}
const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);

// The log is APPEND-ONLY as of 2026-10-28 (card t_4ed8918e), so it accumulates
// `settlement_confirmed` lines forever. "The log contains a confirmed line" therefore
// cannot mean "this attempt is done" — read that way the verifier is permanently a
// no-op, and truncating the log to re-enable it is exactly how the 06:02Z settlement
// lost its three lines (commit f6e2c2c). Confirmation is per-TX, not per-file.
const confirmedTxs = new Set(
  lines
    .filter((l) => l.includes('settlement_confirmed'))
    .map((l) => (/tx=(0x[0-9a-fA-F]{64})/.exec(l) || [])[1])
    .filter(Boolean)
);

const attempts = lines
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((o) => o && o.event === 'settlement_attempt' && o.route === ROUTE);
const unconfirmed = attempts.filter((x) => !(x.tx_hash && confirmedTxs.has(x.tx_hash)));
if (unconfirmed.length === 0) {
  if (attempts.length) {
    console.log(`already confirmed — no-op (${attempts.length} attempt(s) for ${ROUTE}, every tx already confirmed on-chain)`);
    process.exit(2);
  }
  console.error(`no settlement_attempt for ${ROUTE} in the append-only log — nothing to verify`);
  process.exit(1);
}
if (unconfirmed.length !== 1) {
  console.error(
    `expected exactly 1 unconfirmed settlement_attempt for ${ROUTE}, found ${unconfirmed.length} — refusing (reconcile one settlement at a time)`
  );
  process.exit(1);
}
const a = unconfirmed[0];
if (!a.tx_hash) { console.error('attempt has no tx hash — cannot prove payment'); process.exit(1); }

(async () => {
  const viem = require(path.join(projectDir, 'node_modules/viem'));
  const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));
  const c = viem.createPublicClient({ chain: base, transport: viem.http(RPC) });

  const receipt = await c.getTransactionReceipt({ hash: a.tx_hash });
  const transfers = receipt.logs
    .filter((l) => l.address.toLowerCase() === USDC_BASE.toLowerCase() && l.topics[0] === TRANSFER_TOPIC)
    .map((l) => ({
      from: '0x' + l.topics[1].slice(26).toLowerCase(),
      to: '0x' + l.topics[2].slice(26).toLowerCase(),
      value: BigInt(l.data).toString(),
    }));

  const expected = transfers.filter(
    (t) => t.to === OUR_PAYTO.toLowerCase() && t.from === String(a.payer).toLowerCase() && t.value === String(a.expected_units)
  );

  console.log(`tx        ${a.tx_hash}`);
  console.log(`status    ${receipt.status} (block ${Number(receipt.blockNumber)})`);
  console.log(`transfers ${transfers.length}: ${JSON.stringify(transfers)}`);

  if (receipt.status !== 'success') { console.error('receipt status is not success'); process.exit(1); }
  if (expected.length !== 1) {
    console.error(`expected exactly 1 USDC transfer ${a.payer} -> ${OUR_PAYTO} of ${a.expected_units} units; matching=${expected.length}`);
    process.exit(1);
  }

  const line =
    `settlement_confirmed route=${ROUTE} tx=${a.tx_hash} ts=${new Date().toISOString()} ` +
    `payer=${a.payer} payee=${OUR_PAYTO} units=${a.expected_units} usdc=${a.quoted_usdc} ` +
    `onchain=success block=${Number(receipt.blockNumber)} spent_usdc=${a.spent_usdc} ` +
    `extension=${JSON.stringify(a.extension_responses)} relay_verify=${a.verify_status} relay_settle=${a.settle_status}`;
  fs.appendFileSync(LOG_PATH, line + '\n');
  console.log('\n' + line);
})().catch((e) => { console.error('VERIFY ERROR:', e.message); process.exit(1); });
