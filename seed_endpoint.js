#!/usr/bin/env node
/**
 * Parameterized CDP Bazaar seeder — catalogs ANY of our x402 routes by settling ONE
 * payment through the Worker's raw /internal/cdp-settle-raw proxy (bypasses the
 * @x402 resource-server ajv-on-Workers wall). Generalizes seed_raw_cdp.js.
 *
 *   node seed_endpoint.js /crypto/funding
 *
 * Price/asset/payTo are read from the LIVE 402 challenge, so this is price-agnostic:
 * whatever the deployed endpoint advertises is what the buyer signs. Buyer = the
 * throwaway funded wallet (from != payTo; CDP rejects self-sends). Seeds move USDC
 * buyer -> our payTo (recycled). Human-only (moves on-chain funds).
 */
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const BASE = 'https://x402-data-api.sigrunner.workers.dev';

// Per-route discovery config + searchable metadata. Discovery example MUST be an
// OBJECT (CDP validator: /output/example must be object) even for array endpoints.
const ROUTES = {
  '/crypto/funding': {
    description: 'Cross-venue perpetual funding rates from Hyperliquid — per-coin hourly funding, annualized %, mark/oracle price, open interest, 24h volume. Agent-native, pay-per-call via x402.',
    serviceName: 'Crypto Perp Funding Rates (Hyperliquid)',
    tags: ['crypto', 'funding', 'perps', 'hyperliquid', 'defi', 'data'],
    input: { limit: '20' },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Max coins to return, ranked by 24h volume (default 20, max 100)' },
      },
    },
    example: { coin: 'BTC', funding: 0.0000125, fundingAnnualizedPct: 10.95, markPx: 63755.2, oraclePx: 63769.1, openInterest: 37534.28, dayNtlVlm: 1659905049.29 },
  },
  '/defi/yields': {
    description: 'Top DeFi lending/LP yields from DefiLlama — project, chain, symbol, APY (base+reward), TVL, stablecoin flag. Filter by project/chain/stablecoin. Agent-native, pay-per-call via x402.',
    serviceName: 'DeFi Lending Yields (DefiLlama)',
    tags: ['defi', 'yield', 'lending', 'apy', 'tvl', 'data'],
    input: { limit: '20' },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Max pools to return, ranked by TVL (default 20, max 100)' },
        project: { type: 'string', description: 'Optional protocol filter (e.g. aave-v3, morpho-blue)' },
        chain: { type: 'string', description: 'Optional chain filter (e.g. Ethereum, Base)' },
        stable: { type: 'string', description: 'Set "true" to return only stablecoin pools' },
      },
    },
    example: { project: 'aave-v3', chain: 'Ethereum', symbol: 'USDC', apy: 4.21, apyBase: 4.21, apyReward: 0, tvlUsd: 1234567890, stablecoin: true },
  },
  '/crypto/prices': {
    description: 'Spot token prices from DefiLlama — pass coingecko ids, get price, symbol, confidence, timestamp. Agent-native, pay-per-call via x402.',
    serviceName: 'Crypto Spot Prices (DefiLlama)',
    tags: ['crypto', 'prices', 'token-price', 'defi', 'data'],
    input: { coins: 'bitcoin,ethereum,solana' },
    inputSchema: {
      type: 'object',
      properties: {
        coins: { type: 'string', description: 'Comma-separated coingecko ids (e.g. bitcoin,ethereum,solana), max 25' },
      },
    },
    example: { id: 'bitcoin', symbol: 'BTC', price: 63731.49, confidence: 0.99, timestamp: 1784244902 },
  },
  '/chain/block-number': {
    description: 'Current Base mainnet block number. Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Block Number (RPC)',
    tags: ['rpc', 'base', 'onchain', 'blockchain', 'data'],
    input: {},
    inputSchema: { type: 'object', properties: {} },
    example: { block_number: 21000000, chain: 'base' },
  },
  '/chain/gas-price': {
    description: 'Current Base mainnet gas price (wei + gwei). Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Gas Price (RPC)',
    tags: ['rpc', 'base', 'onchain', 'gas', 'data'],
    input: {},
    inputSchema: { type: 'object', properties: {} },
    example: { gas_price_wei: '28434870', gas_price_gwei: 0.02843487, chain: 'base' },
  },
  '/chain/balance': {
    description: 'Native ETH balance of an address on Base mainnet. Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Address Balance (RPC)',
    tags: ['rpc', 'base', 'onchain', 'wallet', 'data'],
    input: { address: '0x4200000000000000000000000000000000000006' },
    inputSchema: { type: 'object', properties: { address: { type: 'string', description: '0x-prefixed 40-hex address' } } },
    example: { address: '0x4200000000000000000000000000000000000006', balance_wei: '0', balance_eth: 0, chain: 'base' },
  },
  '/chain/token-balance': {
    description: 'ERC-20 token balance of an address on Base mainnet. Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Token Balance (RPC)',
    tags: ['rpc', 'base', 'onchain', 'token', 'data'],
    input: { address: '0x4200000000000000000000000000000000000006', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'holder 0x address' }, token: { type: 'string', description: 'ERC-20 token 0x address' } } },
    example: { address: '0x4200000000000000000000000000000000000006', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', balance_raw: '0', chain: 'base' },
  },
  '/chain/tx': {
    description: 'Transaction details by hash on Base mainnet. Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Transaction Lookup (RPC)',
    tags: ['rpc', 'base', 'onchain', 'transaction', 'data'],
    input: { hash: '0x0000000000000000000000000000000000000000000000000000000000000000' },
    inputSchema: { type: 'object', properties: { hash: { type: 'string', description: '0x-prefixed 64-hex tx hash' } } },
    example: { hash: '0x...', from: '0x...', to: '0x...', value: '0', blockNumber: '21000000' },
  },
  '/chain/receipt': {
    description: 'Transaction receipt (status, gas used, logs) by hash on Base mainnet. Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Transaction Receipt (RPC)',
    tags: ['rpc', 'base', 'onchain', 'transaction', 'data'],
    input: { hash: '0x0000000000000000000000000000000000000000000000000000000000000000' },
    inputSchema: { type: 'object', properties: { hash: { type: 'string', description: '0x-prefixed 64-hex tx hash' } } },
    example: { tx_hash: '0x...', status: 1, block_number: 21000000, gas_used: 21000, from: '0x...', to: '0x...', logs_count: 0 },
  },
  '/chain/code': {
    description: 'Whether an address is a contract on Base mainnet (code presence + size). Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Contract Check (RPC)',
    tags: ['rpc', 'base', 'onchain', 'contract', 'data'],
    input: { address: '0x4200000000000000000000000000000000000006' },
    inputSchema: { type: 'object', properties: { address: { type: 'string', description: '0x-prefixed 40-hex address' } } },
    example: { address: '0x4200000000000000000000000000000000000006', is_contract: true, code_size_bytes: 12345, chain: 'base' },
  },
  '/chain/wallet': {
    description: 'One-call wallet summary on Base mainnet: ETH balance, tx count, contract flag. Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Wallet Summary (RPC bundle)',
    tags: ['rpc', 'base', 'onchain', 'wallet', 'data'],
    input: { address: '0x4200000000000000000000000000000000000006' },
    inputSchema: { type: 'object', properties: { address: { type: 'string', description: '0x-prefixed 40-hex address' } } },
    example: { address: '0x4200000000000000000000000000000000000006', balance_wei: '0', balance_eth: 0, tx_count: 42, is_contract: false, chain: 'base' },
  },
};

const route = process.argv[2];
if (!route || !ROUTES[route]) {
  console.error('usage: node seed_endpoint.js <route>');
  console.error('known routes:', Object.keys(ROUTES).join(', '));
  process.exit(2);
}
const cfg = ROUTES[route];
const RESOURCE = `${BASE}${route}`;

const wallet = JSON.parse(fs.readFileSync(path.join(projectDir, 'buyer-wallet.json'), 'utf-8'));
const viemAccounts = require(path.join(projectDir, 'node_modules/viem/accounts'));
const { createWalletClient, createPublicClient, http } = require(path.join(projectDir, 'node_modules/viem'));
const { toClientEvmSigner } = require(path.join(projectDir, 'node_modules/@x402/evm'));
const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));

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

  // 1. 402 challenge (clean URL — matches routeTemplate). Price/asset/payTo from here.
  const initial = await fetch(RESOURCE);
  const prHeader = initial.headers.get('payment-required');
  if (!prHeader) { console.error('no payment-required header for', RESOURCE, '- is it deployed + gated?'); process.exit(1); }
  const paymentRequired = JSON.parse(Buffer.from(prHeader, 'base64').toString());
  const a = paymentRequired.accepts[0];
  console.log(`[${route}] price=${a.amount || a.maxAmountRequired} asset=${a.asset} payTo=${a.payTo}`);

  // 2. Buyer signs.
  const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);

  // 3. SDK bazaar discovery ext + #2156 workaround (info.input.method + routeTemplate).
  const { declareDiscoveryExtension } = require(path.join(projectDir, 'node_modules/@x402/extensions/dist/cjs/bazaar/index.js'));
  const disc = declareDiscoveryExtension({
    method: 'GET',
    input: cfg.input,
    inputSchema: cfg.inputSchema,
    output: { example: cfg.example },
  });
  const bazaar = disc.bazaar || disc;
  bazaar.info = bazaar.info || {};
  bazaar.info.input = bazaar.info.input || {};
  bazaar.info.input.type = bazaar.info.input.type || 'http';
  bazaar.info.input.method = 'GET';
  bazaar.routeTemplate = bazaar.routeTemplate || route;
  paymentPayload.extensions = { ...(paymentPayload.extensions || {}), bazaar };

  // CDP: paymentPayload.resource (object) is REQUIRED to PUBLISH (not just settle).
  paymentPayload.resource = {
    url: RESOURCE,
    resource: RESOURCE,
    description: cfg.description,
    mimeType: 'application/json',
    serviceName: cfg.serviceName,
    tags: cfg.tags,
  };

  // 4. Flat v2 paymentRequirements CDP expects + echo bazaar.
  const paymentRequirements = {
    scheme: a.scheme,
    network: a.network,
    amount: a.amount || a.maxAmountRequired,
    resource: paymentRequired.resource?.url || RESOURCE,
    description: cfg.description,
    mimeType: 'application/json',
    payTo: a.payTo,
    maxTimeoutSeconds: a.maxTimeoutSeconds || 300,
    asset: a.asset,
    extra: a.extra,
    serviceName: cfg.serviceName,
    tags: cfg.tags,
    extensions: { bazaar },
  };

  console.log(`--- POSTing raw settle for ${route} ---`);
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
