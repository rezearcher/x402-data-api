#!/usr/bin/env node
/**
 * One-time: create a throwaway buyer wallet (B) and fund it with a little USDC from
 * the main wallet (0x5765) so we can settle a from!=to seed payment (CDP rejects
 * self-sends). Buyer needs USDC only — EIP-3009 settlement is gasless for the payer.
 */
const path = require('path');
const fs = require('fs');
const projectDir = path.resolve(process.env.HOME, 'projects/x402-data-api');
const { createWalletClient, createPublicClient, http, encodeFunctionData } = require(path.join(projectDir, 'node_modules/viem'));
const { privateKeyToAccount, generatePrivateKey } = require(path.join(projectDir, 'node_modules/viem/accounts'));
const { base } = require(path.join(projectDir, 'node_modules/viem/chains'));

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const FUND_UNITS = 30000n; // 0.03 USDC (enough for several $0.005 seeds)
const BUYER_PATH = path.join(projectDir, 'buyer-wallet.json');

async function main() {
  const main = JSON.parse(fs.readFileSync(path.resolve(process.env.HOME, '.hermes/secrets/base-wallet.json'), 'utf-8'));
  const funder = privateKeyToAccount(main.privateKey);

  let buyer;
  if (fs.existsSync(BUYER_PATH)) {
    buyer = JSON.parse(fs.readFileSync(BUYER_PATH, 'utf-8'));
    console.log('reusing existing buyer wallet:', buyer.address);
  } else {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    buyer = { address: acct.address, privateKey: pk };
    fs.writeFileSync(BUYER_PATH, JSON.stringify(buyer, null, 2), { mode: 0o600 });
    console.log('created buyer wallet:', buyer.address);
  }

  const pub = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
  const bal = await pub.readContract({ address: USDC, abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [buyer.address] });
  console.log('buyer USDC balance:', Number(bal) / 1e6);
  if (bal >= FUND_UNITS) { console.log('already funded enough, skipping transfer'); return; }

  const wallet = createWalletClient({ account: funder, chain: base, transport: http('https://mainnet.base.org') });
  const data = encodeFunctionData({ abi: [{ name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }], functionName: 'transfer', args: [buyer.address, FUND_UNITS] });
  console.log(`funding ${Number(FUND_UNITS) / 1e6} USDC: ${funder.address} -> ${buyer.address}`);
  const hash = await wallet.sendTransaction({ to: USDC, data });
  console.log('tx:', hash, '— waiting for confirmation...');
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log('status:', receipt.status);
  const bal2 = await pub.readContract({ address: USDC, abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [buyer.address] });
  console.log('buyer USDC balance now:', Number(bal2) / 1e6);
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
