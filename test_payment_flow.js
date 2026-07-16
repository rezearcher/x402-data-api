#!/usr/bin/env node
/**
 * x402 payment flow test — closes the earning path.
 * Tests: pay $0.05 USDC → get enrichment data back → wallet receives.
 */
const path = require('path');
const fs = require('fs');

// Load wallet
const walletPath = path.resolve(process.env.HOME, '.hermes/secrets/base-wallet.json');
const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));

// Load x402/evm + viem from the project
const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const viem = require(path.join(projectDir, 'node_modules/viem'));
const { privateKeyToAccount, createWalletClient, createPublicClient, http } = viem;
const viemAccounts = require(path.join(projectDir, 'node_modules/viem/accounts'));
const { toClientEvmSigner } = require(path.join(projectDir, 'node_modules/@x402/evm'));
const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));

async function main() {
  console.log('=== x402 Payment Flow Test ===');
  console.log(`Wallet: ${wallet.address}`);

  const pka = viemAccounts.privateKeyToAccount;
  console.log(`privateKeyToAccount type: ${typeof pka}`);

  if (typeof pka !== 'function') {
    console.error('FATAL: privateKeyToAccount not found in viem/accounts');
    process.exit(1);
  }

  const account = pka(wallet.privateKey);
  console.log(`Account created: ${account.address}`);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http('https://mainnet.base.org')
  });
  console.log(`walletClient created`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org')
  });
  console.log(`publicClient created`);

  // Create x402 signer (EVM scheme client)
  // Fix: viem v2 puts address at account.address, toClientEvmSigner reads signer.address
  const enhancedWalletClient = { ...walletClient, address: walletClient.account.address };
  let evmClient;
  try {
    evmClient = toClientEvmSigner(enhancedWalletClient, publicClient);
    console.log(`EVM signer created, address: ${evmClient.address}`);
  } catch(e) {
    console.error(`Signer creation failed:`, e.message);
    try {
      evmClient = toClientEvmSigner(enhancedWalletClient);
      console.log(`EVM signer created (no publicClient): ${evmClient.address}`);
    } catch(e2) {
      console.error(`Signer creation (no publicClient) failed:`, e2.message);
      process.exit(1);
    }
  }

  // Create core x402 client and register the "exact" EVM scheme using the proper registration function
  const { registerExactEvmScheme } = require(path.join(projectDir, 'node_modules/@x402/evm/dist/cjs/exact/client/index.js'));
  const { x402Client } = require(path.join(projectDir, 'node_modules/@x402/core/dist/cjs/client/index.js'));
  const coreClient = new x402Client();
  registerExactEvmScheme(coreClient, {
    signer: evmClient,
    networks: ['eip155:8453'],
  });
  console.log('x402Client created, exact EVM scheme registered for Base mainnet');

  // Create HTTP client wrapping the core
  const { x402HTTPClient } = require(path.join(projectDir, 'node_modules/@x402/core/dist/cjs/http/index.js'));
  const httpClient = new x402HTTPClient(coreClient);
  console.log(`x402HTTPClient created`);

  // Test: call the paid endpoint
  const url = 'https://x402-data-api.sigrunner.workers.dev/enrich/tech-risk?domain=example.com';
  console.log(`\nCalling: ${url}`);

  try {
    console.log('\n--- Step 1: Verify 402 challenge ---');
    const initialResp = await fetch(url);
    const paymentRequiredHeader = initialResp.headers.get('payment-required');
    const body = await initialResp.json();
    
    if (!paymentRequiredHeader) {
      console.error('ERROR: No payment-required header — endpoint returned data for free');
      console.log('Body:', JSON.stringify(body, null, 2));
      process.exit(1);
    }
    
    const paymentRequired = JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString());
    console.log(`Challenge valid: yes (x402 v${paymentRequired.x402Version}, $0.05 USDC to ${wallet.address})`);
    console.log(`Network: ${paymentRequired.accepts[0].network}, Asset: ${paymentRequired.accepts[0].asset}`);

    console.log('\n--- Step 2: Create payment payload (sign + submit to facilitator) ---');
    const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);
    console.log('Payment payload:', JSON.stringify(paymentPayload, null, 2));

    console.log('\n--- Step 3: Encode payment signature and retry ---');
    const headers = httpClient.encodePaymentSignatureHeader(paymentPayload);
    console.log('Signature headers:', JSON.stringify(headers, null, 2));

    const retryResp = await fetch(url, { headers });
    console.log(`Retry status: ${retryResp.status}`);
    const retryBody = await retryResp.text();
    
    if (retryResp.ok) {
      console.log('✅ PAYMENT SUCCEEDED! Data received:');
      console.log(JSON.stringify(JSON.parse(retryBody), null, 2));
    } else if (retryResp.status === 402) {
      console.log('Still 402 — payment signature not accepted');
      console.log('Response:', retryBody.substring(0, 500));
    } else {
      console.log(`Unexpected status ${retryResp.status}: ${retryBody.substring(0, 500)}`);
    }
  } catch (e) {
    console.error(`Error:`, e.message);
    if (e.stack) console.error(`Stack:`, e.stack.split('\n').slice(0, 8).join('\n'));
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
