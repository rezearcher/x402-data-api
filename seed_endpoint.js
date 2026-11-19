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
 * Requires RAPIDAPI_PROXY_SECRET env var (source from .env or shell).
 */
const path = require('path');
const fs = require('fs');

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const BASE = 'https://x402-data-api.sigrunner.workers.dev';

// audit-q3 F1 (t_2576bb7f): /internal/cdp-settle-raw is gated behind
// RAPIDAPI_PROXY_SECRET. Load .env (gitignored) if present, then require the
// secret — the gate fails closed, so without it every settle 401s.
try {
  const envFile = path.join(projectDir, '.env');
  if (fs.existsSync(envFile)) {
    for (const raw of fs.readFileSync(envFile, 'utf-8').split('\n')) {
      const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch {}
// --dry-run (or DRY_RUN=1): build + sign the full CDP payload and print it, but
// SKIP the settle POST — moves ZERO on-chain funds. Lets anyone verify a route's
// discovery metadata/payload is valid before the human-gated real seed.
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const RAPIDAPI_PROXY_SECRET = process.env.RAPIDAPI_PROXY_SECRET;
if (!RAPIDAPI_PROXY_SECRET && !DRY_RUN) {
  console.error('FATAL: RAPIDAPI_PROXY_SECRET is required (audit-q3 F1 gates /internal/cdp-settle-raw). Add it to ' + path.join(projectDir, '.env') + ' or export it. (Use --dry-run to build+sign the payload without settling.)');
  process.exit(1);
}

// Per-route discovery config + searchable metadata. Discovery example MUST be an
// OBJECT (CDP validator: /output/example must be object) even for array endpoints.
const ROUTES = {
  '/crypto/fear-greed': {
    description: 'Crypto market sentiment index 0-100 with history. No required params. Agent-native, pay-per-call via x402.',
    serviceName: 'Crypto Fear & Greed Index',
    tags: ['crypto','sentiment','fear-greed','data'],
    input: { days: '7' },
    inputSchema: { type: 'object', properties: { days:{type:'string',description:'Days of history (default 7, max 90)'} } },
    example: { value: 59, classification: 'Greed' },
  },
  '/crypto/trending': {
    description: 'Coins trending on CoinGecko now with rank and 24h change. No params. Agent-native, pay-per-call via x402.',
    serviceName: 'Trending Coins (CoinGecko)',
    tags: ['crypto','trending','coingecko','data'],
    input: {},
    inputSchema: { type: 'object', properties: {  } },
    example: { name: 'Bitcoin', symbol: 'BTC', market_cap_rank: 1 },
  },
  '/defi/fees-top': {
    description: 'Top DeFi protocols by 24h fees with market total. No required params. Agent-native, pay-per-call via x402.',
    serviceName: 'Top DeFi Protocols by Fees (DefiLlama)',
    tags: ['defi','fees','revenue','data'],
    input: { limit: '20' },
    inputSchema: { type: 'object', properties: { limit:{type:'string',description:'Max rows (default 20, max 100)'} } },
    example: { name: 'Tether', fees24h_usd: 1000000 },
  },
  '/crypto/global': {
    description: 'Global crypto market cap, volume, BTC/ETH dominance in one call. No params. Agent-native, pay-per-call via x402.',
    serviceName: 'Global Crypto Market Stats (CoinGecko)',
    tags: ['crypto','market','global','data'],
    input: {},
    inputSchema: { type: 'object', properties: {  } },
    example: { total_market_cap_usd: 3900000000000, btc_dominance_pct: 57.1 },
  },
  '/defi/yields-top': {
    description: 'Top DeFi yield pools by TVL with APY; optional chain/stable filters. No required params. Agent-native, pay-per-call via x402.',
    serviceName: 'Top DeFi Yields (DefiLlama)',
    tags: ['defi','yield','apy','data'],
    input: { limit: '20' },
    inputSchema: { type: 'object', properties: { limit:{type:'string',description:'Max rows (default 20, max 100)'}, chain:{type:'string',description:'Chain filter'}, stable:{type:'string',description:'true = stablecoin pools only'} } },
    example: { chain: 'Ethereum', project: 'lido', symbol: 'STETH', apy: 2.22 },
  },
  '/crypto/markets-top': {
    description: 'Top coins by market cap with price, volume, 24h change. No required params. Agent-native, pay-per-call via x402.',
    serviceName: 'Top Crypto Markets (CoinGecko)',
    tags: ['crypto','markets','price','data'],
    input: { limit: '20' },
    inputSchema: { type: 'object', properties: { limit:{type:'string',description:'Max rows (default 20, max 100)'} } },
    example: { symbol: 'BTC', price_usd: 82028, change_24h_pct: 1.07 },
  },
  '/crypto/movers': {
    description: 'Top 24h gainers and losers among top-100 coins. No params. Agent-native, pay-per-call via x402.',
    serviceName: 'Crypto Movers (CoinGecko)',
    tags: ['crypto','movers','gainers','losers','data'],
    input: {},
    inputSchema: { type: 'object', properties: {  } },
    example: { gainers: [{ symbol: 'XYZ', change_24h_pct: 12.3 }] },
  },
  '/brief/market': {
    description: 'One-call crypto market brief: sentiment, global stats, movers, trending, top DeFi fees. No params. Agent-native, pay-per-call via x402.',
    serviceName: 'Crypto Market Brief (one call)',
    tags: ['crypto','market','brief','snapshot','data'],
    input: {},
    inputSchema: { type: 'object', properties: {  } },
    example: { fear_greed: { value: 59, classification: 'Greed' } },
  },
  '/crypto/exchanges-top': {
    description: 'Top crypto exchanges by trust score, country, 24h volume. No params. Agent-native, pay-per-call via x402.',
    serviceName: 'Top Crypto Exchanges (CoinGecko)',
    tags: ['crypto','exchanges','trust','data'],
    input: {},
    inputSchema: { type: 'object', properties: {  } },
    example: { name: 'Kraken', trust_score: 10 },
  },
  '/defi/hacks-recent': {
    description: 'Most recent DeFi and crypto hacks/exploits with amount lost, chain and technique (DefiLlama). Optional limit. Agent-native, pay-per-call via x402.',
    serviceName: 'DeFi Hacks & Exploits Feed (DefiLlama)',
    tags: ['defi','security','hacks','exploits','data'],
    input: { limit: '10' },
    inputSchema: { type: 'object', properties: { limit: { type: 'string', description: 'optional, max 50' } } },
    example: { name: 'Example Protocol', amount_usd: 1000000, chain: ['Ethereum'] },
  },
  '/crypto/derivatives-exchanges': {
    description: 'Top crypto derivatives exchanges by open interest and volume. No params. Agent-native, pay-per-call via x402.',
    serviceName: 'Crypto Derivatives Exchanges (CoinGecko)',
    tags: ['crypto','derivatives','futures','open-interest','data'],
    input: {},
    inputSchema: { type: 'object', properties: {  } },
    example: { name: 'Binance (Futures)', open_interest_btc: 403937 },
  },
  '/defi/protocol-risk': {
    description: 'DeFi protocol due-diligence risk score joining TVL, age, audits and hack history (DefiLlama). ?protocol=<slug>, default aave-v3. Agent-native, pay-per-call via x402.',
    serviceName: 'DeFi Protocol Risk Score',
    tags: ['defi','risk','security','due-diligence','data'],
    input: { protocol: 'aave-v3' },
    inputSchema: { type: 'object', properties: { protocol: { type: 'string', description: 'DefiLlama slug, default aave-v3' } } },
    example: { protocol: 'aave-v3', risk_score: 82, flags: [] },
  },
  '/defi/safe-yields': {
    description: 'Vetted stablecoin yields joined with protocol age, audits and hack history, safest first (DefiLlama). Optional chain, limit. Agent-native, pay-per-call via x402.',
    serviceName: 'Vetted Stablecoin Yields',
    tags: ['defi','yield','stablecoin','risk','data'],
    input: { limit: '10' },
    inputSchema: { type: 'object', properties: { chain: { type: 'string', description: 'optional chain filter' }, limit: { type: 'string', description: 'optional, max 30' } } },
    example: { project: 'aave-v3', chain: 'Ethereum', symbol: 'USDC', apy: 4.2, safety_score: 85 },
  },
  '/crypto/categories': {
    description: 'Crypto sector market cap and 24h change by category. No params. Agent-native, pay-per-call via x402.',
    serviceName: 'Crypto Sector Performance (CoinGecko)',
    tags: ['crypto','sectors','categories','data'],
    input: {},
    inputSchema: { type: 'object', properties: {  } },
    example: { name: 'Smart Contract Platform', market_cap_change_24h_pct: 1.2 },
  },
  '/defi/protocols-top': {
    description: 'Top DeFi protocols ranked by TVL with 1d/7d change. No required params. Agent-native, pay-per-call via x402.',
    serviceName: 'Top DeFi Protocols by TVL (DefiLlama)',
    tags: ['defi','protocols','tvl','data'],
    input: { limit: '20' },
    inputSchema: { type: 'object', properties: { limit:{type:'string',description:'Max rows (default 20, max 100)'} } },
    example: { name: 'Aave', category: 'Lending', tvl_usd: 30000000000, change_1d: 0.4 },
  },
  '/defi/dex-volume': {
    description: 'Top DEXs by 24h trading volume with market total. No required params. Agent-native, pay-per-call via x402.',
    serviceName: 'Top DEXs by 24h Volume (DefiLlama)',
    tags: ['defi','dex','volume','data'],
    input: { limit: '20' },
    inputSchema: { type: 'object', properties: { limit:{type:'string',description:'Max rows (default 20, max 100)'} } },
    example: { name: 'Curve DEX', volume24h_usd: 42754326 },
  },
  '/defi/chains-tvl': {
    description: 'Top blockchains ranked by total DeFi TVL. No required params. Agent-native, pay-per-call via x402.',
    serviceName: 'DeFi TVL by Chain (DefiLlama)',
    tags: ['defi','tvl','chains','data'],
    input: { limit: '20' },
    inputSchema: { type: 'object', properties: { limit:{type:'string',description:'Max rows (default 20, max 100)'} } },
    example: { name: 'Ethereum', tvl_usd: 90000000000, token: 'ETH' },
  },
  '/crypto/stablecoins': {
    description: 'Top stablecoins by circulating supply with peg price. No required params. Agent-native, pay-per-call via x402.',
    serviceName: 'Stablecoin Supply and Peg (DefiLlama)',
    tags: ['crypto','stablecoins','depeg','supply','data'],
    input: { limit: '20' },
    inputSchema: { type: 'object', properties: { limit:{type:'string',description:'Max rows (default 20, max 100)'} } },
    example: { symbol: 'USDT', price: 0.9994, circulating_usd: 183456438967 },
  },
  '/ai/classify': {
    description: 'Zero-shot text classification: pass text and comma-separated labels, get the single best label. Agent-native, pay-per-call via x402.',
    serviceName: 'Text Classifier (LLM)',
    tags: ['ai','llm','classification','text','data'],
    input: { text: 'My card was charged twice', labels: 'billing,bug,feature_request,other' },
    inputSchema: { type: 'object', properties: { text:{type:'string',description:'Text, max 1000 chars'},labels:{type:'string',description:'Comma-separated labels, 2-10'} } },
    example: { label: 'billing' },
  },
  '/ai/summarize': {
    description: 'Summarize a passage into 1-3 sentences. Agent-native, pay-per-call via x402.',
    serviceName: 'Text Summarizer (LLM)',
    tags: ['ai','llm','summarization','text','data'],
    input: { text: 'x402 is an open HTTP 402 payment protocol letting clients pay per request in USDC on Base without accounts or API keys.' },
    inputSchema: { type: 'object', properties: { text:{type:'string',description:'Passage, max 1500 chars'} } },
    example: { summary: 'x402 lets clients pay per request in USDC on Base.' },
  },
  '/ai/translate': {
    description: 'Translate text into a target language. Agent-native, pay-per-call via x402.',
    serviceName: 'Text Translator (LLM)',
    tags: ['ai','llm','translation','language','data'],
    input: { text: 'Hello, how are you?', to: 'es' },
    inputSchema: { type: 'object', properties: { text:{type:'string',description:'Text, max 800 chars'},to:{type:'string',description:'Target language code, e.g. es, fr, de, ja'} } },
    example: { translation: 'Hola, ¿cómo estás?' },
  },
  '/ai/extract': {
    description: 'Extract structured JSON with exactly the fields you name from messy text. Agent-native, pay-per-call via x402.',
    serviceName: 'Text-to-JSON Extractor (LLM)',
    tags: ['ai','llm','extraction','json','structured','data'],
    input: { text: 'Acme paid $40 on May 3 to Bob', fields: 'payer,amount,date' },
    inputSchema: { type: 'object', properties: { text:{type:'string',description:'Text, max 1500 chars'},fields:{type:'string',description:'Comma-separated field names'} } },
    example: { payer: 'Acme', amount: 40, date: 'May 3' },
  },
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
  '/chain/token-security': {
    description: 'Token security / honeypot detector for a Base mainnet ERC-20: EIP-1967/1822 proxy + upgradeability detection, bytecode dispatcher scan for mint/pause/blacklist/fee-setter/ownership selectors, owner() renouncement check, and a live eth_call state-override simulation testing whether a synthetic wallet can actually transfer() the token. Returns risk_score + verdict (clear/review/block) + human-readable flags.',
    serviceName: 'Token Security / Honeypot Detector (Base RPC)',
    tags: ['rpc', 'base', 'onchain', 'token', 'security', 'honeypot', 'data'],
    input: { token: '0x4200000000000000000000000000000000000006' },
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: '0x-prefixed 20-byte ERC-20 contract address on Base mainnet' },
      },
    },
    example: { token: '0x4200000000000000000000000000000000000006', chain: 'base', is_contract: true, proxy: { is_proxy: false, proxy_standard: null, implementation_address: null, admin_address: null, is_upgradeable: false }, capabilities: { can_mint: false, can_burn: false, can_pause: false, has_blacklist: false, has_fee_setter: false, has_ownership: false, detected_selectors: [], scanned_address: '0x4200000000000000000000000000000000000006' }, ownership: { owner: null, ownership_renounced: false, owner_type: 'none' }, risk_score: 0, verdict: 'clear', flags: [] },
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
  '/chain/is-contract': {
    description: 'Is a Base address a smart contract or an EOA? Returns is_contract and bytecode size. Use when an agent must decide whether a recipient is a contract before sending funds or approving it.',
    serviceName: 'Base Is-Contract Check (RPC)',
    tags: ['rpc', 'base', 'onchain', 'contract', 'data'],
    input: { address: '0x4200000000000000000000000000000000000006' },
    inputSchema: { type: 'object', properties: { address: { type: 'string', description: '0x-prefixed 20-byte Base address' } } },
    example: { address: '0x4200000000000000000000000000000000000006', is_contract: true, code_bytes: 2000, chain: 'base' },
  },
  '/chain/wallet': {
    description: 'One-call wallet summary on Base mainnet: ETH balance, tx count, contract flag. Agent-native onchain read, pay-per-call via x402.',
    serviceName: 'Base Wallet Summary (RPC bundle)',
    tags: ['rpc', 'base', 'onchain', 'wallet', 'data'],
    input: { address: '0x4200000000000000000000000000000000000006' },
    inputSchema: { type: 'object', properties: { address: { type: 'string', description: '0x-prefixed 40-hex address' } } },
    example: { address: '0x4200000000000000000000000000000000000006', balance_wei: '0', balance_eth: 0, tx_count: 42, is_contract: false, chain: 'base' },
  },
  '/pm/markets': {
    description: 'Query live Polymarket prediction markets — question, outcomes, live prices, bestBid/bestAsk/spread, volume24hr/volume1wk, oneDayPriceChange, clobTokenIds, conditionId, category tags, liquidity, end date. Ranked by volume24hr; filter by keyword. Agent-native, pay-per-call via x402.',
    serviceName: 'Polymarket Prediction Markets (PolyCLOB)',
    tags: ['prediction-markets', 'polymarket', 'polyclob', 'defi', 'data'],
    input: { limit: '20', query: 'bitcoin' },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Max markets to return (default 20, max 100)' },
        query: { type: 'string', description: 'Optional keyword filter matched against the market question' },
      },
    },
    example: { question: 'Will X happen by 2026?', slug: 'will-x-happen-by-2026', outcomes: ['Yes', 'No'], outcomePrices: [0.65, 0.35], volume: 1234567.89, volume24hr: 84213.45, volume1wk: 412987.6, liquidity: 45678.12, endDate: '2026-12-31T12:00:00Z', active: true, bestBid: 0.64, bestAsk: 0.66, spread: 0.02, oneDayPriceChange: 0.01, clobTokenIds: ['264852...', '884780...'], conditionId: '0xb6d6f15a1b5d08753653f1867ccd6126badfbe182a75159a330dc7b15336b30', tags: ['Crypto', 'Bitcoin'] },
  },

  // --- Line-A TRUST/SAFETY WEDGE routes (metadata from each route's LIVE 402 body) ---
  // These are the differentiated routes invisible in the CDP Bazaar because none has
  // had a settled CDP call yet (the 6 commodity rows did). Adding them here makes each
  // one-command seedable so the wedge surfaces where funded agents actually browse.
  '/x402/preflight': {
    description: 'Should an agent pay this x402 endpoint? One read-only call (never pays): validates the 402 + accepts[] (will it settle), labels liveness LIVE|ZOMBIE|DEAD, flags a >=$1000 price-trap honeypot (=> AVOID), scans resource + MCP tools for LLM01/LLM08 injection, screens payTo vs OFAC/scam, checks price (live vs advertised: MATCH|OVERCHARGE|UNDERCHARGE) and cache-leakage posture. Returns PAY|CAUTION|AVOID + fix hints. Not a settlement guarantee.',
    serviceName: 'x402 Pre-Payment Safety Check',
    tags: ['x402', 'preflight', 'safe-to-pay', 'verify', 'payment'],
    input: { url: 'https://api.greyridgesignals.ai/crypto/prices' },
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'the x402 endpoint URL to pre-check before paying' },
        advertised: { type: 'string', description: 'optional: the price (USDC dollars) your catalog quoted — returns MATCH/OVERCHARGE/UNDERCHARGE vs the live accepts[].amount' },
        max: { type: 'string', description: 'optional: your per-call budget ceiling in USDC dollars — flags price_trap if the live charge exceeds it' },
        samples: { type: 'integer', description: 'optional reliability burst: sample the 402 challenge N times (1-5)' },
      },
    },
    example: { url: 'https://api.greyridgesignals.ai/crypto/prices', verdict: 'PAY', will_settle: true, checks: [{ name: 'challenge', ok: true }, { name: 'payTo_safety', ok: true }, { name: 'price', ok: true, detail: 'MATCH' }] },
  },
  '/x402/cert': {
    description: 'Mint a DEEP VERIFIED certificate for YOUR x402 endpoint ($1 USDC, no account). Certifies the depth axis a liveness-only verified badge cannot: price accuracy, delivery readiness, LLM01/LLM08 injection safety, payTo OFAC/scam screening. Pass &tx=<a Base settlement hash> to also PROVE it settled USDC to its advertised payTo on-chain, dual-RPC confirmed. HMAC-signed 30-day cert + embeddable badge that re-audits live. Fails honest: no cert unless the audit returns PAY.',
    serviceName: 'x402 Settlement Certificate',
    tags: ['x402', 'certificate', 'settlement', 'receipt', 'trust'],
    input: { url: 'https://api.greyridgesignals.ai/crypto/prices' },
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'the x402 endpoint URL to certify' },
        advertised: { type: 'string', description: 'optional: advertised price (USDC dollars) to assert against the live 402' },
        tx: { type: 'string', description: 'optional: a Base settlement tx hash to additionally prove on-chain USDC settlement to the advertised payTo' },
      },
    },
    example: { url: 'https://api.greyridgesignals.ai/crypto/prices', verdict: 'PAY', cert_id: 'grsg-cert-...', issued_at: '2026-11-18T00:00:00Z', expires_at: '2026-12-18T00:00:00Z', badge_url: 'https://x402-data-api.sigrunner.workers.dev/x402/badge?...', signature: 'hmac-...' },
  },
  '/x402/receipt-verify': {
    description: 'Did my x402 payment actually settle? POST-payment on-chain proof (the other half of /x402/preflight): bring your Base settlement tx + the resource URL you paid, and this reads the tx receipt, decodes its USDC Transfer events, and reconciles them against the endpoint advertised payTo + amount (from its live 402, or pass payto/expect). Verdict SETTLED | UNDERPAID | WRONG_RECIPIENT | NO_TRANSFER | REVERTED | NOT_FOUND | UNVERIFIED. Read-only; confirms settlement, not off-chain delivery.',
    serviceName: 'x402 Payment Receipt Verify',
    tags: ['x402', 'receipt', 'settlement', 'verify', 'payment'],
    input: { tx: '0x0000000000000000000000000000000000000000000000000000000000000000', url: 'https://api.greyridgesignals.ai/crypto/prices' },
    inputSchema: {
      type: 'object',
      required: ['tx'],
      properties: {
        tx: { type: 'string', description: '0x-prefixed 64-hex Base settlement tx hash to verify' },
        url: { type: 'string', description: 'optional: the resource URL you paid (its live 402 supplies expected payTo + amount)' },
        payto: { type: 'string', description: 'optional: expected recipient address if not deriving from url' },
        expect: { type: 'string', description: 'optional: expected USDC amount (dollars) to reconcile against' },
      },
    },
    example: { tx: '0x...', verdict: 'SETTLED', paid_to: '0x...', amount_usdc: 0.001, expected_usdc: 0.001, confirmations: 32 },
  },
  '/chain/wallet-screen': {
    description: 'Is this wallet sanctioned OR a known scammer? Pre-trade screen for a counterparty / recipient / token-spender address before an agent sends, swaps or approves — exact match against (1) the U.S. Treasury OFAC SDN crypto-address list and (2) community scam/phishing/wallet-drainer threat-intel (ScamSniffer + MEW darklist). Returns sanctioned + malicious + verdict (blocked/clear) + the list sources and snapshot dates. clear = not on these lists, not a safety guarantee.',
    serviceName: 'OFAC Wallet Sanctions Screen',
    tags: ['sanctions', 'ofac', 'compliance', 'scam', 'phishing'],
    input: { address: '0x4200000000000000000000000000000000000006' },
    inputSchema: {
      type: 'object',
      required: ['address'],
      properties: {
        address: { type: 'string', description: '0x-prefixed wallet/recipient/spender address to screen' },
      },
    },
    example: { address: '0x4200000000000000000000000000000000000006', sanctioned: false, malicious: false, verdict: 'clear', sources: ['OFAC-SDN', 'ScamSniffer', 'MEW-darklist'] },
  },
  '/chain/token-report': {
    description: 'Is this Base token safe to buy? One call returns a decision-grade trade-safety verdict — SAFE | CAUTION | AVOID — with risk_score (0-100) and reasons: honeypot/sellability simulation, owner-renounced + mint/pause/blacklist/fee-setter/upgradeable-proxy checks, symbol/name/decimals, and Uniswap v3 WETH-pool liquidity (USD). Replaces many RPC calls and prevents a bad trade. Use when an agent is about to buy or swap a Base ERC-20 and needs a SAFE/CAUTION/AVOID decision.',
    serviceName: 'Base Token Safety & Rug Check',
    tags: ['token-safety', 'honeypot', 'rug-check', 'base', 'erc20'],
    input: { token: '0x4200000000000000000000000000000000000006' },
    inputSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', description: '0x-prefixed Base mainnet ERC-20 contract address' },
      },
    },
    example: { token: '0x4200000000000000000000000000000000000006', verdict: 'SAFE', risk_score: 5, reasons: ['owner renounced', 'sellable in simulation'], liquidity_usd: 12500000, chain: 'base' },
  },
  '/defi/yield-entry-verdict': {
    description: 'Per-pool DeFi yield-entry verdict: pass ?pool=<DefiLlama poolId from /defi/yields> and get a packaged SUSTAINABLE|DECAYING|OUTLIER|AVOID go/no-go + 0-100 risk score + field-cited reasons, built from the pool APY trend (1d/7d/30d), DefiLlama stability forecast, impermanent loss (il7d), volatility (sigma), outlier flag and TVL. Optional ?token=<0x underlying, Base> adds a honeypot-check pointer. Use after /defi/yields finds a high-APY pool to get a go/no-go on THAT pool before funding.',
    serviceName: 'DeFi Yield Entry Verdict',
    tags: ['defi', 'yield', 'entry-verdict', 'risk-score', 'apy'],
    input: { pool: '747c1d2c-f1bc-4b32-aab0-4c80b7a1e2cf' },
    inputSchema: {
      type: 'object',
      required: ['pool'],
      properties: {
        pool: { type: 'string', description: 'DefiLlama poolId (from /defi/yields) to score for entry' },
        token: { type: 'string', description: 'optional: 0x underlying token (Base) to add a honeypot-check pointer' },
      },
    },
    example: { pool: '747c1d2c-f1bc-4b32-aab0-4c80b7a1e2cf', verdict: 'SUSTAINABLE', risk_score: 22, reasons: ['apy stable 1d/7d/30d', 'TVL > $10M', 'il7d low'], apy: 4.2, tvlUsd: 12345678 },
  },
};

const route = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!route || !ROUTES[route]) {
  console.error('usage: node seed_endpoint.js <route> [--dry-run]');
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

  if (DRY_RUN) {
    console.log(`--- DRY RUN for ${route}: payload built + signed, NOT settling (zero funds move) ---`);
    console.log('resource:', JSON.stringify(paymentPayload.resource));
    console.log('bazaar.routeTemplate:', bazaar.routeTemplate, '| serviceName:', paymentRequirements.serviceName, '| tags:', JSON.stringify(paymentRequirements.tags));
    console.log('paymentRequirements amount/asset/payTo:', paymentRequirements.amount, paymentRequirements.asset, paymentRequirements.payTo);
    console.log('DRY RUN OK — this route is seed-ready. Run without --dry-run (human-gated) to settle + publish.');
    return;
  }

  console.log(`--- POSTing raw settle for ${route} ---`);
  const res = await fetch(`${BASE}/internal/cdp-settle-raw`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-RapidAPI-Proxy-Secret': RAPIDAPI_PROXY_SECRET,
    },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  const out = await res.json();
  console.log('proxy status:', res.status);

  // decode extension responses for debugging
  for (const phase of ['verify', 'settle']) {
    if (out[phase]?.extensionResponses) {
      try {
        const decoded = JSON.parse(Buffer.from(out[phase].extensionResponses, 'base64').toString());
        console.log(`  [${phase} bazaar response]:`, JSON.stringify(decoded, null, 2).slice(0, 2000));
      } catch (e) {
        console.log(`  [${phase} decode error]:`, e.message);
      }
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('Fatal:', e.message, e.stack?.split('\n').slice(0, 4).join('\n')); process.exit(1); });
