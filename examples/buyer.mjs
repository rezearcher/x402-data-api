// Grey Ridge x402 — minimal runnable buyer.
//
// The single thing every integrator stalls on is "how do I actually make the paid
// call?" This is the whole answer: an x402 GET that signs + settles USDC on Base
// inline. No API key, no account, no gas ETH (the scheme is EIP-3009 gasless).
//
//   npm i x402-fetch viem
//   EVM_PRIVATE_KEY=0xYOURKEY node examples/buyer.mjs                  # default: token-report on DEGEN
//   EVM_PRIVATE_KEY=0xYOURKEY node examples/buyer.mjs /gate/swap?token=0x...&side=buy&notional_usd=500
//
// The private key is a normal Base EOA holding a little USDC. Nothing is sent
// anywhere except the signed EIP-3009 authorization the x402 facilitator submits.

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";

const BASE = process.env.X402_BASE_URL || "https://x402-data-api.sigrunner.workers.dev";
const PATH = process.argv[2] || "/chain/token-report?token=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed"; // DEGEN

const key = process.env.EVM_PRIVATE_KEY;
if (!key) {
  console.error("Set EVM_PRIVATE_KEY (a 0x Base EOA holding USDC). Preview first, no wallet needed:");
  console.error(`  curl -s "${BASE}/chain/token-report/preview?token=aero"`);
  process.exit(1);
}

const account = privateKeyToAccount(key);
const walletClient = createWalletClient({ account, chain: base, transport: http() });

// wrapFetchWithPayment(fetch, walletClient) — 2nd arg is a viem WalletClient, NOT a bare account.
const f = wrapFetchWithPayment(fetch, walletClient);

const url = `${BASE}${PATH}`;
console.error(`→ paying + fetching ${url}  (payer ${account.address})`);
const r = await f(url);
console.error(`← HTTP ${r.status}`);
console.log(JSON.stringify(await r.json(), null, 2));
