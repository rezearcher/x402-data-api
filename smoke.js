#!/usr/bin/env node
/**
 * Paid smoke test — real x402 GET (pay via xpay) against a live endpoint, prints
 * the resource BODY. Proves the paid->data path end to end.
 *   node smoke.js "/crypto/prices?coins=bitcoin,ethereum,solana"
 * Payer = buyer wallet (from != payTo). Spends the endpoint's advertised price.
 */
const path = require('path');
const fs = require('fs');
const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const BASE = 'https://x402-data-api.sigrunner.workers.dev';

const wallet = JSON.parse(fs.readFileSync(path.join(projectDir, 'buyer-wallet.json'), 'utf-8'));
const viemAccounts = require(path.join(projectDir, 'node_modules/viem/accounts'));
const { createWalletClient, createPublicClient, http } = require(path.join(projectDir, 'node_modules/viem'));
const { toClientEvmSigner } = require(path.join(projectDir, 'node_modules/@x402/evm'));
const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));

const rel = process.argv[2];
if (!rel) { console.error('usage: node smoke.js "/path?query"'); process.exit(2); }
const url = `${BASE}${rel}`;

async function main() {
  const account = viemAccounts.privateKeyToAccount(wallet.privateKey);
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });
  const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const evmClient = toClientEvmSigner({ ...walletClient, address: walletClient.account.address }, publicClient);

  const { registerExactEvmScheme } = require(path.join(projectDir, 'node_modules/@x402/evm/dist/cjs/exact/client/index.js'));
  const { x402Client } = require(path.join(projectDir, 'node_modules/@x402/core/dist/cjs/client/index.js'));
  const { x402HTTPClient } = require(path.join(projectDir, 'node_modules/@x402/core/dist/cjs/http/index.js'));
  const coreClient = new x402Client();
  registerExactEvmScheme(coreClient, { signer: evmClient, networks: ['eip155:8453'] });
  const httpClient = new x402HTTPClient(coreClient);

  const initial = await fetch(url);
  const prh = initial.headers.get('payment-required');
  if (!prh) { console.error('no 402 challenge — got', initial.status); process.exit(1); }
  const paymentRequired = JSON.parse(Buffer.from(prh, 'base64').toString());
  console.log(`402 ok: pay ${paymentRequired.accepts[0].amount} units to ${paymentRequired.accepts[0].payTo}`);

  const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);
  const headers = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const retry = await fetch(url, { headers });
  console.log('retry status:', retry.status);
  const body = await retry.text();
  if (retry.ok) {
    console.log('BODY:');
    try { console.log(JSON.stringify(JSON.parse(body), null, 2).slice(0, 1400)); }
    catch { console.log(body.slice(0, 1400)); }
  } else {
    console.log('non-200:', body.slice(0, 500));
  }
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
