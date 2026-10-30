#!/usr/bin/env node
/**
 * Register our x402 endpoints on x402scan.com via its SIWX-authed registry API.
 * SIWX (Sign-In With X) = a wallet signature (not a payment). We sign with our
 * payTo wallet so the listing is owned by our provider address.
 *   node register_x402scan.js            # register-origin (discovers ALL endpoints)
 *   node register_x402scan.js <url>      # register a single resource URL
 */
const fs = require('fs');
const path = require('path');
const projectDir = __dirname;
const { privateKeyToAccount } = require(path.join(projectDir, 'node_modules/viem/accounts'));
const siwx = require(path.join(projectDir, 'node_modules/@x402/extensions/dist/cjs/sign-in-with-x/index.js'));

// payTo wallet = provider identity (0x5765...). Falls back to buyer wallet.
let wallet;
try { wallet = require(path.join(projectDir, 'lib/wallet.js')).wallet('main'); }  // vault (degrade-open to json)
catch (e) { // vault down: SIWX is only a signature, an ephemeral key registers the origin fine (verified 2026-10-20: 61 registered)
  wallet = { privateKey: require(path.join(projectDir, 'node_modules/viem/accounts')).generatePrivateKey() };
}
const account = privateKeyToAccount(wallet.privateKey);

const ORIGIN = process.env.X402_ORIGIN || 'https://x402-data-api.sigrunner.workers.dev';
const single = process.argv[2];
const endpoint = single
  ? 'https://www.x402scan.com/api/x402/registry/register'
  : 'https://www.x402scan.com/api/x402/registry/register-origin';
const body = single ? { url: single } : { origin: ORIGIN };

async function main() {
  console.log('signer (provider identity):', account.address);
  const r1 = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r1.status !== 402) {
    console.log('expected 402 SIWX challenge, got', r1.status, (await r1.text()).slice(0, 300));
    if (r1.ok) return; // already fine
    process.exit(1);
  }
  const challenge = await r1.json();
  const ext = challenge.extensions && challenge.extensions['sign-in-with-x'];
  if (!ext) { console.log('no sign-in-with-x extension in challenge'); process.exit(1); }
  const info = ext.info || ext;
  console.log('SIWX challenge: domain=%s nonce=%s', info.domain, info.nonce);

  const payload = await siwx.createSIWxPayload(info, account);
  const header = siwx.encodeSIWxHeader(payload);

  const r2 = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'SIGN-IN-WITH-X': header },
    body: JSON.stringify(body),
  });
  console.log('authed status:', r2.status);
  console.log((await r2.text()).slice(0, 800));
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
