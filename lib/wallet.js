// lib/wallet.js — resolve a wallet {address, privateKey} from the 1Password vault
// at runtime, so the private key never persists as a plaintext file. The spend cap
// lives at the funding choke point (fund_buyer.js daily cap). Degrades OPEN: if op/
// the vault is unavailable it falls back to the legacy json file if one still exists,
// so this can never brick signing. Reads only metadata paths; the key stays in memory.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function opBin() {
  const h = process.env.HOME;
  if (fs.existsSync(h + '/bin/op')) return h + '/bin/op';
  return process.env.OP_BIN || 'op';
}

function ensureToken() {
  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) return;
  try {
    const m = fs.readFileSync(process.env.HOME + '/.config/greyridge/op.env', 'utf8')
      .match(/OP_SERVICE_ACCOUNT_TOKEN=\"?([^\"\n]+)/);
    if (m) process.env.OP_SERVICE_ACCOUNT_TOKEN = m[1];
  } catch (e) { /* ignore */ }
}

function opRead(ref) {
  ensureToken();
  return execFileSync(opBin(), ['read', ref], { encoding: 'utf8' }).trim();
}

// which: 'buyer' (hot, tiny float) | 'main' (receiving 0x5765, funds the buyer)
function wallet(which) {
  const item = which === 'main' ? 'MAIN_WALLET_PK' : 'BUYER_WALLET_PK';
  let pk = null;
  try { pk = opRead(`op://Division/${item}/credential`); } catch (e) { pk = null; }
  if (!pk) {
    const f = which === 'main'
      ? path.resolve(process.env.HOME, '.hermes/secrets/base-wallet.json')
      : path.join(process.cwd(), 'buyer-wallet.json');
    pk = JSON.parse(fs.readFileSync(f, 'utf8')).privateKey;  // degrade-open
  }
  const { privateKeyToAccount } = require(path.join(process.cwd(), 'node_modules/viem/accounts'));
  const acct = privateKeyToAccount(pk);
  return { address: acct.address, privateKey: pk };
}

module.exports = { wallet };
