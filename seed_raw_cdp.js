#!/usr/bin/env node
/**
 * Seed the CDP Bazaar catalog for GET /pm/markets by settling ONE payment through
 * the CDP facilitator via the Worker's raw /internal/cdp-settle-raw proxy (which
 * bypasses the @x402 resource server's ajv-on-Workers wall). We manually attach a
 * correctly-`method`-ed bazaar discovery extension so CDP catalogs the route.
 */
const path = require('path');
const fs = require('fs');

// Buyer = throwaway funded wallet (from != payTo; CDP rejects self-sends).
const walletPath = path.join(path.resolve(process.env.HOME, 'projects/x402-data-api'), 'buyer-wallet.json');
const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const viemAccounts = require(path.join(projectDir, 'node_modules/viem/accounts'));
const { createWalletClient, createPublicClient, http } = require(path.join(projectDir, 'node_modules/viem'));
const { toClientEvmSigner } = require(path.join(projectDir, 'node_modules/@x402/evm'));
const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));

const BASE = 'https://x402-data-api.sigrunner.workers.dev';
const RESOURCE = `${BASE}/pm/markets`;

async function main() {
  const account = viemAccounts.privateKeyToAccount(wallet.privateKey);
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });
  const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const enhanced = { ...walletClient, address: walletClient.account.address };
  const evmClient = toClientEvmSigner(enhanced, publicClient);

  const { registerExactEvmScheme } = require(path.join(projectDir, 'node_modules/@x402/evm/dist/cjs/exact/client/index.js'));
  const { x402Client } = require(path.join(projectDir, 'node_modules/@x402/core/dist/cjs/client/index.js'));
  const coreClient = new x402Client();
  registerExactEvmScheme(coreClient, { signer: evmClient, networks: ['eip155:8453'] });

  // 1. Get the 402 challenge for /pm/markets (clean URL — matches routeTemplate)
  const initial = await fetch(RESOURCE);
  const prHeader = initial.headers.get('payment-required');
  if (!prHeader) { console.error('no payment-required header'); process.exit(1); }
  const paymentRequired = JSON.parse(Buffer.from(prHeader, 'base64').toString());
  console.log('paymentRequired keys:', Object.keys(paymentRequired));
  console.log('accepts[0]:', JSON.stringify(paymentRequired.accepts[0]));
  console.log('resource:', JSON.stringify(paymentRequired.resource));

  // 2. Buyer signs the payment
  const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);

  // 3. SDK-generate the bazaar discovery extension (correct schema + structure),
  //    then apply the #2156 workaround (ensure info.input.method + routeTemplate).
  const { declareDiscoveryExtension } = require(path.join(projectDir, 'node_modules/@x402/extensions/dist/cjs/bazaar/index.js'));
  // Query-method config (GET) with method set explicitly — the enricher that would
  // normally set it (bazaarResourceServerExtension) can't run on Workers (ajv). #2156.
  const disc = declareDiscoveryExtension({
    method: 'GET',
    input: { limit: '20', query: 'bitcoin' },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Max number of markets to return (default 20, max 100)' },
        query: { type: 'string', description: 'Optional keyword filter matched against the market question' },
      },
    },
    output: {
      // Discovery example must be an OBJECT (CDP validator: /output/example must be object),
      // even though the live endpoint returns an array of these.
      example: { question: 'Will X happen by 2026?', slug: 'will-x-happen-by-2026', outcomes: ['Yes', 'No'], outcomePrices: [0.65, 0.35], volume: 1234567.89, liquidity: 45678.12, endDate: '2026-12-31T12:00:00Z', active: true },
    },
  });
  const bazaar = disc.bazaar || disc;
  bazaar.info = bazaar.info || {};
  bazaar.info.input = bazaar.info.input || {};
  bazaar.info.input.type = bazaar.info.input.type || 'http';
  bazaar.info.input.method = 'GET';
  bazaar.routeTemplate = bazaar.routeTemplate || '/pm/markets';
  console.log('generated bazaar ext:', JSON.stringify(bazaar));
  paymentPayload.extensions = { ...(paymentPayload.extensions || {}), bazaar };

  // 4. Build the single paymentRequirements CDP expects (flat, v2) + echo bazaar.
  const a = paymentRequired.accepts[0];
  const paymentRequirements = {
    scheme: a.scheme,
    network: a.network,
    amount: a.amount || a.maxAmountRequired,
    resource: paymentRequired.resource?.url || RESOURCE,
    description: paymentRequired.resource?.description || 'Polymarket prediction-market data',
    mimeType: paymentRequired.resource?.mimeType || 'application/json',
    payTo: a.payTo,
    maxTimeoutSeconds: a.maxTimeoutSeconds || 300,
    asset: a.asset,
    extra: a.extra,
    extensions: { bazaar },
  };

  console.log('\n--- POSTing raw to /internal/cdp-settle-raw ---');
  const res = await fetch(`${BASE}/internal/cdp-settle-raw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  const out = await res.json();
  console.log('proxy status:', res.status);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('Fatal:', e.message, e.stack?.split('\n').slice(0, 4).join('\n')); process.exit(1); });
