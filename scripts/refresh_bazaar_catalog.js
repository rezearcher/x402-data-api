#!/usr/bin/env node
/**
 * refresh_bazaar_catalog.js — Scheduled refresher for the CDP x402 Bazaar catalog.
 *
 * WHY: Bazaar freshness (quality.lastCalledAt / l30DaysTotalCalls / lastUpdated)
 * only updates when a payment settles THROUGH the CDP facilitator. Production
 * settles via xpay (FACILITATOR_MODE="xpay", see src/index.ts:983-1004), so every
 * real payment is invisible to the Bazaar's freshness/ranking signal and our 13
 * catalogued routes look dead (frozen 2026-07-16..07-28). This script performs
 * one cheap self-funded canary settlement per route through the CDP facilitator,
 * piggybacking on the existing /internal/cdp-settle-raw proxy (src/index.ts:427)
 * — the same proven path used by seed_batch_cdp.js — WITHOUT touching the live
 * xpay settlement path.
 *
 * MECHANISM per route (identical to the proven seed scripts):
 *   1. GET the route -> parse the `payment-required` 402 challenge
 *   2. Sign an EIP-3009 exact payment with the local buyer wallet (gasless for
 *      the payer; CDP facilitator relays the transfer)
 *   3. Attach the bazaar discovery extension (#2156 workaround: info.input.method
 *      + routeTemplate) + paymentPayload.resource metadata
 *   4. POST {paymentPayload, paymentRequirements} to /internal/cdp-settle-raw
 *      (the Worker mints the CDP JWT from its existing secrets server-side)
 *
 * REVENUE EXCLUSION (guardrail): payer = buyer-wallet (0xC4852c...), payee =
 * PAY_TO (0x5765ae...). Both are SELF_ADDRS in scripts/verify_revenue_ledger.py,
 * so any on-chain row from these settlements classifies as self_traffic and is
 * NEVER counted toward revenue_usd_corrected / gap.json. The proxy itself does
 * not write the revenue ledger.
 *
 * COOLDOWN: per-route state persisted to scripts/.bazaar_refresh_cooldown.json;
 * default 20h so a daily cron cannot double-fire. Pass --force to ignore.
 *
 * Usage:
 *   node scripts/refresh_bazaar_catalog.js [--force] [--route /chain/balance]
 * Exit code: 0 = all due routes settled (or skipped by cooldown); 1 = any failure.
 */
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const BASE = 'https://x402-data-api.sigrunner.workers.dev';
const COOLDOWN_PATH = path.join(__dirname, '.bazaar_refresh_cooldown.json');
const COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20h

const FORCE = process.argv.includes('--force');
const ONLY_ROUTE = process.argv.includes('--route') ? process.argv[process.argv.indexOf('--route') + 1] : null;

// ── Route manifest: the 13 routes catalogued in the CDP Bazaar (verified live
// 2026-08-11 via the public discovery API). Metadata mirrors the per-route
// declareDiscoveryExtension() calls in src/index.ts and the /.well-known/x402
// manifest. Path-param routes (/scan/mcp, /enrich/*, /dns/*, /whois/*) are NOT
// in the Bazaar and are out of scope for freshness refresh.
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
          question: 'Will X happen by 2026?', slug: 'will-x-happen-by-2026',
          outcomes: ['Yes', 'No'], outcomePrices: [0.65, 0.35],
          volume: 1234567.89, liquidity: 45678.12, endDate: '2026-12-31T12:00:00Z', active: true,
        },
      },
    },
  },
  {
    route: '/crypto/funding',
    desc: 'Cross-venue Hyperliquid+OKX+dYdX perp funding rates — top coins by 24h notional volume, per-venue funding + arb spread (bps) + cheapest-long/richest-short venue, premium/basis, annualized rates, LONGS_PAY/SHORTS_PAY/NEUTRAL signal.',
    serviceName: 'Cross-Venue Perp Funding Rates',
    tags: ['crypto', 'funding', 'perps', 'hyperliquid', 'okx', 'dydx', 'arbitrage', 'defi', 'data'],
    disc: {
      method: 'GET',
      input: { limit: '20' },
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Max coins to return (default 20, max 100)' },
        },
      },
      output: {
        example: {
          coin: 'BTC',
          funding: { hyperliquid: 0.0000125, okx: 0.0000492, dydx: -0.00000875 },
          funding_spread_bps: 0.37, best_long_venue: 'hyperliquid', best_short_venue: 'okx',
          annualized_hl: 0.1095, signal: 'LONGS_PAY', next_funding_ts: 1784304000000,
          markPx: 63730, oraclePx: 63750, openInterest: 37519.86, dayNtlVlm: 1670654479.06,
        },
      },
    },
  },
  {
    route: '/defi/yields',
    desc: 'Top DeFi lending/LP yields — project, chain, symbol, pool id, APY breakdown + 1d/7d/30d APY trend, IL risk, exposure, reward/underlying tokens, outlier flag, DefiLlama stability forecast, TVL.',
    serviceName: 'Top DeFi Yields',
    tags: ['defi', 'yield', 'lending', 'apy', 'tvl', 'data'],
    disc: {
      method: 'GET',
      input: { limit: '20', project: 'aave-v3', chain: 'Ethereum', stable: 'true', sort: 'tvl' },
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Max pools to return (default 20, max 100)' },
          project: { type: 'string', description: 'Optional: filter to an exact project name' },
          chain: { type: 'string', description: 'Optional: filter to an exact chain name' },
          stable: { type: 'string', description: 'Optional: "true" for stablecoin pools only' },
          sort: { type: 'string', description: 'Optional: "tvl" (default) or "risk_adjusted"' },
        },
      },
      output: {
        example: {
          project: 'aave-v3', chain: 'Ethereum', symbol: 'USDC', pool: '747c1d2a-c668-4682-b9f9-296708a3dd90',
          apy: 4.21, apyBase: 3.1, apyReward: 1.11, tvlUsd: 512345678, stablecoin: true,
          ilRisk: 'no', outlier: false, risk_adjusted_apy: 78.75,
        },
      },
    },
  },
  {
    route: '/crypto/prices',
    desc: 'Spot token prices from DefiLlama — pass comma-separated CoinGecko ids, get price/change_24h/symbol/confidence/timestamp.',
    serviceName: 'Spot Token Prices',
    tags: ['crypto', 'prices', 'token-price', 'defi', 'data'],
    disc: {
      method: 'GET',
      input: { coins: 'bitcoin,ethereum,solana' },
      inputSchema: {
        type: 'object',
        properties: {
          coins: { type: 'string', description: 'Comma-separated CoinGecko ids (max 25)' },
        },
      },
      output: {
        example: { id: 'bitcoin', symbol: 'BTC', price: 63731.496785708485, change_24h: -1.78, confidence: 0.99, timestamp: 1784244902 },
      },
    },
  },
  {
    route: '/chain/block-number',
    desc: 'Current Base mainnet block number. Lightest endpoint — single eth_call.',
    serviceName: 'Base Block Number Oracle',
    tags: ['block-number', 'block-height', 'base', 'evm', 'chain-liveness', 'data'],
    disc: {
      method: 'GET',
      input: {},
      inputSchema: { type: 'object', properties: {} },
      output: { example: { block_number: 27738421, chain: 'base' } },
    },
  },
  {
    route: '/chain/gas-price',
    desc: 'Current Base mainnet gas price (wei/gwei), EIP-1559 base/priority fees, gas_price_usd. One-call light.',
    serviceName: 'Base Gas Price Oracle',
    tags: ['gas', 'gas-price', 'base', 'evm', 'fee-oracle', 'data'],
    disc: {
      method: 'GET',
      input: {},
      inputSchema: { type: 'object', properties: {} },
      output: {
        example: {
          gas_price_wei: '21284349', gas_price_gwei: 0.021284349, base_fee_gwei: 0.018,
          priority_fee_gwei: 0.0032, gas_price_usd: 3.93e-8, chain: 'base',
        },
      },
    },
  },
  {
    route: '/chain/balance',
    desc: 'ETH balance of a Base mainnet address, incl. balance_usd.',
    serviceName: 'Base ETH Balance Oracle',
    tags: ['balance', 'eth', 'base', 'evm', 'rpc', 'data'],
    disc: {
      method: 'GET',
      input: { address: '0x4200000000000000000000000000000000000006' },
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: '0x-prefixed 20-byte Base address' },
        },
      },
      output: {
        example: {
          address: '0x4200000000000000000000000000000000000006',
          balance_wei: '17265432100000000000', balance_eth: 17.2654321, balance_usd: 31886.15, chain: 'base',
        },
      },
    },
  },
  {
    route: '/chain/token-balance',
    desc: 'ERC-20 token balance of a Base mainnet address, incl. symbol, decimals, balance_formatted.',
    serviceName: 'Base ERC-20 Balance Oracle',
    tags: ['token-balance', 'erc20', 'balance', 'base', 'evm', 'data'],
    disc: {
      method: 'GET',
      input: { address: '0x4200000000000000000000000000000000000006', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: '0x-prefixed 20-byte holder address' },
          token: { type: 'string', description: '0x-prefixed 20-byte ERC-20 contract address' },
        },
      },
      output: {
        example: {
          address: '0x4200000000000000000000000000000000000006', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          symbol: 'USDC', decimals: 6, balance_raw: '1050000', balance_formatted: 1.05, chain: 'base',
        },
      },
    },
  },
  {
    route: '/chain/tx',
    desc: 'Transaction details by hash on Base mainnet.',
    serviceName: 'Base Transaction Oracle',
    tags: ['tx', 'transaction', 'base', 'evm', 'data'],
    disc: {
      method: 'GET',
      input: { hash: '0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef' },
      inputSchema: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: '0x-prefixed 32-byte transaction hash' },
        },
      },
      output: {
        example: {
          hash: '0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef',
          blockNumber: '48747709', from: '0xd80217bd14c4d4a4fe37bb1354be1830ed815a60',
          to: '0x6211a3742cf9d3b6677ecc7fd9dd102ab101d8e2', value: '0', gas: '5000000',
          gasPrice: '322017256', nonce: '6937',
        },
      },
    },
  },
  {
    route: '/chain/receipt',
    desc: 'Transaction receipt by hash on Base mainnet — status, gas used, full logs, L1 fee breakdown.',
    serviceName: 'Base Transaction Receipt Oracle',
    tags: ['receipt', 'tx', 'base', 'evm', 'l1-fee', 'data'],
    disc: {
      method: 'GET',
      input: { hash: '0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef' },
      inputSchema: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: '0x-prefixed 32-byte transaction hash' },
        },
      },
      output: {
        example: {
          status: 1, block_number: 48734000, gas_used: 28859, from: '0xd80217bd14c4d4a4fe37bb1354be1830ed815a60',
          to: '0x6211a3742cf9d3b6677ecc7fd9dd102ab101d8e2', tx_hash: '0x571284385ad512a3ffc984a6c2f335113ada217215b6296847944f9d0bc613ef',
          logs_count: 0, l1_fee_wei: '1158985140', total_fee_usd: 0.0026591,
        },
      },
    },
  },
  {
    route: '/chain/code',
    desc: 'Contract-code check for a Base mainnet address (is_contract + code size + EIP-7702 delegated-EOA detection).',
    serviceName: 'Base Contract-Code Checker',
    tags: ['code', 'contract', 'eip7702', 'base', 'evm', 'data'],
    disc: {
      method: 'GET',
      input: { address: '0x4200000000000000000000000000000000000006' },
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: '0x-prefixed 20-byte Base address' },
        },
      },
      output: {
        example: {
          address: '0x4200000000000000000000000000000000000006', is_contract: true,
          is_eip7702_delegate: false, delegate_address: null, code_size_bytes: 6234, chain: 'base',
        },
      },
    },
  },
  {
    route: '/chain/wallet',
    desc: 'Wallet bundle: ETH balance + balance_usd + tx count + contract-code check for a Base mainnet address, in one call.',
    serviceName: 'Base Wallet Bundle',
    tags: ['wallet', 'balance', 'base', 'evm', 'wallet', 'data'],
    disc: {
      method: 'GET',
      input: { address: '0x4200000000000000000000000000000000000006' },
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: '0x-prefixed 20-byte Base address' },
        },
      },
      output: {
        example: {
          address: '0x4200000000000000000000000000000000000006', balance_wei: '17265432100000000000',
          balance_eth: 17.2654321, balance_usd: 31886.15, tx_count: 4, is_contract: true,
          is_eip7702_delegate: false, delegate_address: null, chain: 'base',
        },
      },
    },
  },
  {
    route: '/chain/token-security',
    desc: 'Token security / honeypot detector for a Base ERC-20: proxy/upgradeability check, mint/pause/blacklist/fee-setter bytecode scan, ownership check, honeypot simulation. Risk score + verdict + flags.',
    serviceName: 'Base Token Security Scanner',
    tags: ['token-security', 'honeypot', 'rug-check', 'base', 'evm', 'smart-contract', 'security'],
    disc: {
      method: 'GET',
      input: { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: '0x-prefixed 20-byte ERC-20 contract address on Base mainnet' },
        },
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
  const results = { refreshed: [], skipped: [], failed: [] };

  const targets = ONLY_ROUTE ? ROUTES.filter((r) => r.route === ONLY_ROUTE) : ROUTES;
  if (ONLY_ROUTE && targets.length === 0) {
    console.error(`unknown route: ${ONLY_ROUTE}`);
    process.exit(1);
  }

  for (const r of targets) {
    const lastRun = cooldowns[r.route];
    if (!FORCE && lastRun && now - lastRun < COOLDOWN_MS) {
      console.log(`SKIP ${r.route} — cooldown until ${new Date(lastRun + COOLDOWN_MS).toISOString()}`);
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

      // 2. Buyer signs the payment (EIP-3009 exact; gasless for the payer)
      const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);

      // 3. Bazaar discovery extension (#2156 workaround, same as seed scripts)
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

      // 4. Flat v2 paymentRequirements for the CDP facilitator
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

      // 5. POST to the Worker's raw CDP settle proxy (CDP JWT minted server-side)
      const settleRes = await fetch(`${BASE}/internal/cdp-settle-raw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentPayload, paymentRequirements }),
      });
      const settleOut = await settleRes.json();

      if (!settleRes.ok || settleOut.error) {
        throw new Error(`CDP settle ${settleRes.status}: ${JSON.stringify(settleOut)}`);
      }

      console.log(`OK — verify=${settleOut.verify?.status} settle=${settleOut.settle?.status}`);
      cooldowns[r.route] = Date.now();
      results.refreshed.push(r.route);
    } catch (e) {
      console.error(`FAIL — ${e.message}`);
      results.failed.push(r.route);
    }
  }

  saveCooldowns(cooldowns);

  console.log('\n══════════ SUMMARY ══════════');
  console.log(`Refreshed: ${results.refreshed.length ? results.refreshed.join(', ') : 'none'}`);
  console.log(`Skipped:   ${results.skipped.length ? results.skipped.join(', ') : 'none'}`);
  console.log(`Failed:    ${results.failed.length ? results.failed.join(', ') : 'none'}`);
  if (results.failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Fatal:', e.message, e.stack?.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
