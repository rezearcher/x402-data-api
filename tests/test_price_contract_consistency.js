/** The advertised price in /openapi.json must equal the amount the live 402 challenge
 * actually charges, and must agree with itself across all four places paid() writes it.
 * Regression guard for the gas-price/block-number/token-balance drift fixed 2026-10-22:
 * ROUTE_CATALOG is the single source of truth and reconcilePaidPrices() forces the doc
 * to it, so a future hardcoded price arg can drift without this test catching it.
 * Real imported app, deterministic upstreams, no payment or live authority. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
register(new URL('./cfw-hooks.mjs', import.meta.url));
const { default: app } = await import('../src/index.ts');

const secret = 'synthetic-price-contract-secret-0123456789';
const store = new Map();
const env = { PAY_TO: '0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10', NETWORK: 'eip155:8453', FACILITATOR_URL: 'http://facilitator.test', RAPIDAPI_PROXY_SECRET: secret,
  USAGE_COUNTER: { idFromName: x => x, get: () => ({ async fetch() { return Response.json({}); } }) } };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (['http://facilitator.test/supported', 'https://facilitator.xpay.sh/supported'].includes(u))
    return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} });
  throw Error(`unexpected upstream in price test: ${u}`);
};

const oas = await (await app.request('/openapi.json', {}, env)).json();
assert.equal(oas.openapi, '3.0.0');

let selfChecks = 0, liveChecks = 0;
for (const [path, def] of Object.entries(oas.paths)) {
  const op = def.get;
  if (!op || typeof op['x-price-usdc'] !== 'number') continue;
  const usd = op['x-price-usdc'];
  const usdStr = String(usd);

  // (1) The four places paid() writes the price must agree with each other.
  assert.ok(op.description.includes(`Price: $${usdStr}.`), `${path}: description price != x-price-usdc (${usdStr})`);
  assert.equal(op['x-payment-info']?.price?.amount, usdStr, `${path}: x-payment-info.amount != x-price-usdc`);
  assert.ok(op.responses?.['402']?.description?.includes(`($${usdStr} USDC`), `${path}: 402 description price != x-price-usdc`);
  selfChecks++;

  // (2) For param-free paid GET routes, the advertised price must equal what the
  // live 402 challenge charges (atoms / 1e6). This is the advertised-vs-charged guard.
  const required = (op.parameters ?? []).some(p => p.required);
  if (required || path.includes('{')) continue;
  const res = await app.request(path, {}, env);
  if (res.status !== 402) continue; // free/preview or non-x402 route
  const body = await res.json();
  const amount = body?.accepts?.[0]?.amount;
  if (amount == null) continue;
  const chargedUsd = Number(amount) / 1e6;
  assert.equal(chargedUsd, usd, `${path}: advertised $${usd} but 402 charges $${chargedUsd} (atoms ${amount})`);
  liveChecks++;
}

assert.ok(selfChecks >= 20, `expected many priced routes, saw ${selfChecks}`);
assert.ok(liveChecks >= 3, `expected to live-verify several param-free routes, saw ${liveChecks}`);
console.log(`price-contract consistency OK (${selfChecks} self-consistent, ${liveChecks} matched the live 402 charge)`);
