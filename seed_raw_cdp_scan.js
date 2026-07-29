#!/usr/bin/env node
/**
 * Seed the CDP Bazaar catalog for GET /scan/mcp by settling ONE payment through
 * the CDP facilitator via the Worker's raw /internal/cdp-settle-raw proxy.
 * Manual bazaar discovery extension with correct method & routeTemplate.
 */
const path = require('path');
const fs = require('fs');

const walletPath = path.join(path.resolve(process.env.HOME, 'projects/x402-data-api'), 'buyer-wallet.json');
const wallet = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));

const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const viemAccounts = require(path.join(projectDir, 'node_modules/viem/accounts'));
const { createWalletClient, createPublicClient, http } = require(path.join(projectDir, 'node_modules/viem'));
const { toClientEvmSigner } = require(path.join(projectDir, 'node_modules/@x402/evm'));
const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));

const BASE = 'https://x402-data-api.sigrunner.workers.dev';
const RESOURCE = `${BASE}/scan/mcp`;

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

  // 1. Get the 402 challenge for /scan/mcp (clean URL — matches routeTemplate)
  const withQuery = `${RESOURCE}?url=https://scan-me.mcp/v1`;
  const initial = await fetch(withQuery);
  const prHeader = initial.headers.get('payment-required');
  if (!prHeader) {
    console.error('no payment-required header — check FACILITATOR_MODE is xpay and route exists');
    console.error('status:', initial.status);
    const text = await initial.text().catch(() => '');
    console.error('body preview:', text.slice(0, 500));
    process.exit(1);
  }
  const paymentRequired = JSON.parse(Buffer.from(prHeader, 'base64').toString());
  console.log('paymentRequired keys:', Object.keys(paymentRequired));
  console.log('accepts[0]:', JSON.stringify(paymentRequired.accepts[0]));
  console.log('resource:', JSON.stringify(paymentRequired.resource));

  // 2. Buyer signs the payment
  const paymentPayload = await coreClient.createPaymentPayload(paymentRequired);

  // 3. SDK-generate the bazaar discovery extension (correct schema + structure),
  //    then apply the #2156 workaround (ensure info.input.method + routeTemplate).
  const { declareDiscoveryExtension } = require(path.join(projectDir, 'node_modules/@x402/extensions/dist/cjs/bazaar/index.js'));
  const disc = declareDiscoveryExtension({
    method: 'GET',
    input: { url: 'https://scan-me.mcp/v1' },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target MCP server endpoint URL to audit' },
      },
    },
    output: {
      example: {
        target: 'https://example.com/mcp',
        tools_scanned: 3,
        findings: [
          { tool: 'read_file', severity: 'critical', rule: 'tool-poisoning:hidden-instructions', detail: '…', evidence: '…' },
        ],
        risk_score: 40,
        verdict: 'review',
        risk_summary: '1 issue across 3 tools, 1 CRITICAL (tool-poisoning). Risk 40/100.',
      },
    },
  });
  const bazaar = disc.bazaar || disc;
  bazaar.info = bazaar.info || {};
  bazaar.info.input = bazaar.info.input || {};
  bazaar.info.input.type = bazaar.info.input.type || 'http';
  bazaar.info.input.method = 'GET';
  bazaar.routeTemplate = bazaar.routeTemplate || '/scan/mcp';
  console.log('generated bazaar ext:', JSON.stringify(bazaar));
  paymentPayload.extensions = { ...(paymentPayload.extensions || {}), bazaar };
  // CDP docs: paymentPayload.resource MUST be included
  paymentPayload.resource = {
    url: withQuery,
    resource: RESOURCE,
    description: 'Security audit of a target MCP server: scans every advertised tool for prompt-injection, tool-poisoning, exfiltration, dangerous-capability, and hidden-unicode attacks (OWASP LLM01/LLM08). Returns findings, risk score, and verdict. Agent-native, pay-per-call via x402.',
    mimeType: 'application/json',
    serviceName: 'MCP Server Security Scanner',
    tags: ['mcp-security', 'ai-security', 'scanning', 'prompt-injection', 'tool-poisoning', 'owasp-llm'],
  };

  // 4. Build paymentRequirements for CDP
  const a = paymentRequired.accepts[0];
  const paymentRequirements = {
    scheme: a.scheme,
    network: a.network,
    amount: a.amount || a.maxAmountRequired,
    resource: paymentRequired.resource?.url || RESOURCE,
    description: paymentRequired.resource?.description || 'MCP Server Security Scanner',
    mimeType: paymentRequired.resource?.mimeType || 'application/json',
    payTo: a.payTo,
    maxTimeoutSeconds: a.maxTimeoutSeconds || 300,
    asset: a.asset,
    extra: a.extra,
    serviceName: 'MCP Server Security Scanner',
    tags: ['mcp-security', 'ai-security', 'scanning', 'prompt-injection', 'tool-poisoning'],
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

main().catch((e) => {
  console.error('Fatal:', e.message, e.stack?.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
