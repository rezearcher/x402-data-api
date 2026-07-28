#!/usr/bin/env node
/**
 * Batch-seed CDP Bazaar catalog entries for multiple routes.
 *
 * Uses the Worker's /internal/cdp-settle-raw proxy to bypass ajv-on-Workers
 * wall. Iterates a route manifest, does x402 challenge → sign → CDP settle
 * dance per route, respecting a cooldown to avoid redundant on-chain txs.
 *
 * Usage: node seed_batch_cdp.js
 */
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const BASE = 'https://x402-data-api.sigrunner.workers.dev';
const COOLDOWN_PATH = path.join(__dirname, '.cdp_seed_cooldown.json');
const SEED_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h

// Route manifest — each entry = discovery metadata matching the route's
// declareDiscoveryExtension() call in src/index.ts
const ROUTES = [
  {
    route: '/pm/markets',
    desc: 'Live Polymarket prediction-market data — question, outcomes, live prices, volume, liquidity, end date. Filter by keyword. Agent-native, pay-per-call via x402.',
    serviceName: 'Polymarket Prediction Market Data',
    tags: ['prediction-markets', 'polymarket', 'markets', 'crypto', 'data', 'trading'],
    disc: {
      method: 'GET',
      input: { limit: '20', query: 'bitcoin' },
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Max markets (default 20, max 100)' },
          query: { type: 'string', description: 'Optional keyword filter' },
        },
      },
      output: {
        example: {
          question: 'Will X happen by 2026?',
          outcomes: ['Yes', 'No'],
          outcomePrices: [0.65, 0.35],
          volume: 1234567.89,
          liquidity: 45678.12,
          endDate: '2026-12-31T12:00:00Z',
          active: true,
        },
      },
    },
  },
  {
    route: '/chain/token-security',
    desc: 'Token security scanner for Base ERC-20 tokens: proxy/upgradeability check, mint/pause/blacklist/fee-setter bytecode scan, ownership check, honeypot simulation. Risk score + verdict + flags.',
    serviceName: 'Base Token Security Scanner',
    tags: ['token-security', 'honeypot', 'rug-check', 'base', 'evm', 'smart-contract', 'security'],
    disc: {
      method: 'GET',
      input: { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: '0x-prefixed 20-byte ERC-20 address on Base' },
        },
      },
      output: {
        example: {
          token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          chain: 'base',
          is_contract: true,
          risk_score: 65,
          verdict: 'review',
        },
      },
    },
  },
  {
    route: '/chain/gas-price',
    desc: 'Current Base mainnet gas price (wei/gwei), EIP-1559 base/priority fees, gas_price_usd. One-call light: ideal for agents pricing txs on Base.',
    serviceName: 'Base Gas Price Oracle',
    tags: ['gas', 'gas-price', 'base', 'evm', 'fee-oracle', 'data'],
    disc: {
      method: 'GET',
      input: {},
      inputSchema: { type: 'object', properties: {} },
      output: {
        example: {
          gas_price_wei: '21284349',
          gas_price_gwei: 0.0213,
          base_fee_gwei: 0.018,
          priority_fee_gwei: 0.0032,
          chain: 'base',
        },
      },
    },
  },
  {
    route: '/chain/block-number',
    desc: 'Current Base mainnet block number. Lightest endpoint — single eth_call. Ideal for chain-liveness checks and tx timing.',
    serviceName: 'Base Block Number Oracle',
    tags: ['block-number', 'block-height', 'base', 'evm', 'chain-liveness', 'data'],
    disc: {
      method: 'GET',
      input: {},
      inputSchema: { type: 'object', properties: {} },
      output: {
        example: { block_number: 27738421, chain: 'base' },
      },
    },
  },
];

// --------------- cooldown persistence ---------------
function loadCooldowns() {
  try {
    return JSON.parse(fs.readFileSync(COOLDOWN_PATH, 'utf-8'));
  } catch {
    return {};
  }
}
function saveCooldowns(cd) {
  fs.writeFileSync(COOLDOWN_PATH, JSON.stringify(cd, null, 2));
}

// --------------- main ---------------
async function main() {
  // Load wallet + deps
  const wallet = JSON.parse(fs.readFileSync(path.join(projectDir, 'buyer-wallet.json'), 'utf-8'));
  const viemAccounts = require(path.join(projectDir, 'node_modules/viem/accounts'));
  const { createWalletClient, createPublicClient, http } = require(path.join(projectDir, 'node_modules/viem'));
  const { toClientEvmSigner } = require(path.join(projectDir, 'node_modules/@x402/evm'));
  const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));
  const { registerExactEvmScheme } = require(path.join(projectDir, 'node_modules/@x402/evm/dist/cjs/exact/client/index.js'));
  const { x402Client } = require(path.join(projectDir, 'node_modules/@x402/core/dist/cjs/client/index.js'));
  const { declareDiscoveryExtension } = require(path.join(projectDir, 'node_modules/@x402/extensions/dist/cjs/bazaar/index.js'));

  const account = viemAccounts.privateKeyToAccount(wallet.privateKey);
  const walletClient = createWalletClient({ account, chain: base, transport: http('https://mainnet.base.org') });
  const publicClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const enhanced = { ...walletClient, address: walletClient.account.address };
  const evmClient = toClientEvmSigner(enhanced, publicClient);
  const coreClient = new x402Client();
  registerExactEvmScheme(coreClient, { signer: evmClient, networks: ['eip155:8453'] });

  const cooldowns = loadCooldowns();
  const now = Date.now();
  const results = { seeded: [], skipped: [], failed: [] };

  for (const r of ROUTES) {
    const lastSeed = cooldowns[r.route];
    if (lastSeed && now - lastSeed < SEED_COOLDOWN_MS) {
      console.log(`SKIP ${r.route} — cooldown until ${new Date(lastSeed + SEED_COOLDOWN_MS).toISOString()}`);
      results.skipped.push(r.route);
      continue;
    }

    const resourceUrl = `${BASE}${r.route}`;
    console.log(`\n── ${r.route} ──`);

    try {
      // 1. Get the x402 challenge
      const initial = await fetch(resourceUrl);
      const prHeader = initial.headers.get('payment-required');
      if (!prHeader) throw new Error('no payment-required header');
      const paymentRequired = JSON.parse(Buffer.from(prHeader, 'base64').toString());

      // 2. Buyer signs the payment
      const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);

      // 3. Build bazaar discovery extension (with #2156 ajv workaround)
      const disc = declareDiscoveryExtension(r.disc);
      const bazaar = disc.bazaar || disc;
      bazaar.info = bazaar.info || {};
      bazaar.info.input = bazaar.info.input || {};
      bazaar.info.input.type = 'http';
      bazaar.info.input.method = 'GET';
      bazaar.routeTemplate = r.route;
      paymentPayload.extensions = { ...(paymentPayload.extensions || {}), bazaar };

      paymentPayload.resource = {
        url: resourceUrl,
        resource: resourceUrl,
        description: r.desc,
        mimeType: 'application/json',
        serviceName: r.serviceName,
        tags: r.tags,
      };

      // 4. Build paymentRequirements for CDP
      const a = paymentRequired.accepts[0];
      const paymentRequirements = {
        scheme: a.scheme,
        network: a.network,
        amount: a.amount || a.maxAmountRequired,
        resource: paymentRequired.resource?.url || resourceUrl,
        description: paymentRequired.resource?.description || r.desc,
        mimeType: paymentRequired.resource?.mimeType || 'application/json',
        payTo: a.payTo,
        maxTimeoutSeconds: a.maxTimeoutSeconds || 300,
        asset: a.asset,
        extra: a.extra,
        serviceName: r.serviceName,
        tags: r.tags,
        extensions: { bazaar },
      };

      // 5. POST to internal CDP settle proxy
      const settleRes = await fetch(`${BASE}/internal/cdp-settle-raw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentPayload, paymentRequirements }),
      });
      const settleOut = await settleRes.json();

      if (!settleRes.ok || settleOut.error) {
        throw new Error(`CDP settle ${settleRes.status}: ${JSON.stringify(settleOut)}`);
      }

      console.log(`OK — ${JSON.stringify(settleOut)}`);
      cooldowns[r.route] = Date.now();
      results.seeded.push(r.route);
    } catch (e) {
      console.error(`FAIL — ${e.message}`);
      results.failed.push(r.route);
    }
  }

  saveCooldowns(cooldowns);

  console.log('\n══════════ SUMMARY ══════════');
  console.log(`Seeded:  ${results.seeded.length  ? results.seeded.join(', ')  : 'none'}`);
  console.log(`Skipped: ${results.skipped.length ? results.skipped.join(', ') : 'none'}`);
  console.log(`Failed:  ${results.failed.length  ? results.failed.join(', ')  : 'none'}`);
}

main().catch((e) => {
  console.error('Fatal:', e.message, e.stack?.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
