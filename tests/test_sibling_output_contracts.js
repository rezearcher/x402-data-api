/** Real imported app, deterministic upstreams, no payment or live authority. */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateDiscoveryExtension } from '@x402/extensions/bazaar';
register(new URL('./cfw-hooks.mjs', import.meta.url));
const { default: app } = await import('../src/index.ts');
const address = '0x4200000000000000000000000000000000000006';
const secret = 'synthetic-sibling-contract-secret-0123456789';
const store = new Map();
const env = { PAY_TO: '0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10', NETWORK: 'eip155:8453', FACILITATOR_URL: 'http://facilitator.test', RAPIDAPI_PROXY_SECRET: secret,
  USAGE_COUNTER: { idFromName: x => x, get: () => ({ async fetch(_url, init = {}) {
    if (init.body) for (const op of JSON.parse(init.body).ops) {
      if (op.kind === 'increment') store.set(op.key, (store.get(op.key) ?? 0) + (op.by ?? 1));
      else if (op.kind === 'set' || !store.has(op.key)) store.set(op.key, op.value);
    }
    return Response.json(Object.fromEntries(store));
  } }) }
};
let state;
let rpcCalls = 0;
const unexpected = [];
function reset(extra = {}) { state = { gas: '0x144c4dd', balance: '0xde0b6b3a7640000', nonce: '0x4', code: '0x', fee: { baseFeePerGas: ['0x112a880'], reward: [['0x30d400']] }, usd: 2000, ...extra }; }
reset();
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (['http://facilitator.test/supported', 'https://facilitator.xpay.sh/supported'].includes(u)) return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} });
  if (['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://base.api.onfinality.io/public', 'https://base-pokt.nodies.app', 'https://base-mainnet.public.blastapi.io', 'https://base.gateway.tenderly.co', 'https://gateway.tenderly.co/public/base'].includes(u)) {
    rpcCalls++;
    if (state.down) throw Error('injected RPC exhaustion');
    const { method } = JSON.parse(init.body);
    const key = { eth_gasPrice: 'gas', eth_getBalance: 'balance', eth_getTransactionCount: 'nonce', eth_getCode: 'code', eth_feeHistory: 'fee', eth_blockNumber: 'block' }[method];
    if (!key) { unexpected.push(method); throw Error(`unexpected method ${method}`); }
    if (state[key] === 'throw') throw Error(`injected ${key} unavailable`);
    return Response.json({ jsonrpc: '2.0', id: 1, result: state[key] });
  }
  if (u === 'https://coins.llama.fi/percentage/coingecko:ethereum?period=24h') return Response.json({ coins: {} });
  if (u === 'https://coins.llama.fi/prices/current/coingecko:ethereum') {
    if (state.usd === 'throw') throw Error('injected USD unavailable');
    return Response.json({ coins: { 'coingecko:ethereum': { price: state.usd, symbol: 'ETH' } } });
  }
  unexpected.push(u); throw Error(`unexpected URL ${u}`);
};
const gasPath = '/chain/gas-price';
const walletPath = `/chain/wallet?address=${address}`;
const roots = {
  '/chain/gas-price': ['gas_price_wei', 'gas_price_gwei', 'base_fee_gwei', 'priority_fee_gwei', 'gas_price_usd', 'chain'],
  '/chain/wallet': ['address', 'balance_wei', 'balance_eth', 'balance_usd', 'tx_count', 'is_contract', 'is_eip7702_delegate', 'delegate_address', 'chain'],
};
async function request(path, auth = secret, target = app) { return target.request(path, auth === null ? {} : { headers: { 'X-RapidAPI-Proxy-Secret': auth } }, env); }
const oas = await (await request('/openapi.json')).json();
assert.equal(oas.openapi, '3.0.0');
const validators = {};
for (const path of [gasPath, '/chain/wallet']) {
  const schema = oas.paths[path].get.responses['200'].content['application/json'].schema;
  assert.deepEqual(schema.required, roots[path]);
  assert.equal(schema.additionalProperties, true);
  assert.deepEqual(schema.properties.chain.enum, ['base']);
  for (const field of path === gasPath ? ['base_fee_gwei', 'priority_fee_gwei', 'gas_price_usd'] : ['balance_usd', 'delegate_address']) {
    assert.equal(schema.properties[field].nullable, true);
    assert.equal(typeof schema.properties[field].type, 'string');
  }
  const before = rpcCalls;
  for (const auth of [null, 'wrong-secret']) {
    const r = await request(path === gasPath ? path : walletPath, auth);
    assert.equal(r.status, 402);
    const challenge = JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString());
    const terms = challenge.accepts[0];
    assert.equal(terms.amount, path === gasPath ? '2000' : '3000');
    assert.equal(terms.network, env.NETWORK);
    assert.equal(terms.payTo.toLowerCase(), env.PAY_TO.toLowerCase());
    assert.equal(terms.asset.toLowerCase(), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    const bazaar = challenge.extensions.bazaar;
    const jsonSchema = bazaar.schema.properties.output.properties.example;
    assert.deepEqual(jsonSchema.required, schema.required);
    assert.deepEqual(bazaar.schema.properties.output.required, ['type']);
    const projected = structuredClone(schema);
    for (const prop of Object.values(projected.properties)) if (prop.nullable) { prop.type = [prop.type, 'null']; delete prop.nullable; }
    assert.deepEqual(jsonSchema, projected);
    if (path !== gasPath) assert.equal(bazaar.schema.properties.input.properties.queryParams?.required?.includes('address') ?? false, false);
    const ajv = new Ajv({ strict: false });
    assert.deepEqual(validateDiscoveryExtension(bazaar), { valid: true });
    const validateWrapper = body => {
      const result = validateDiscoveryExtension({ ...bazaar,
        info: { ...bazaar.info, output: { ...bazaar.info.output, example: body } } });
      validateWrapper.errors = result.errors;
      return result.valid;
    };
    validators[path] = [ajv.compile(schema), new Ajv2020({ strict: false }).compile(jsonSchema), validateWrapper];
  }
  const unconfigured = await app.request(path === gasPath ? path : walletPath,
    { headers: { 'X-RapidAPI-Proxy-Secret': secret } }, { ...env, RAPIDAPI_PROXY_SECRET: undefined });
  assert.equal(unconfigured.status, 402, 'a header without configured authority must not bypass payment');
  assert.equal(rpcCalls, before, 'gating must not run the handler');
}
assert.equal(store.size, 0);
assert.deepEqual(oas.paths['/crypto/prices'].get.responses['200'].content['application/json'].schema, { type: 'object' });
assert.deepEqual(oas.paths['/chain/code'].get.responses['200'].content['application/json'].schema, { type: 'object' });
console.log('ok: OpenAPI / unpaid 402 agreement, nullable dialects, terms, wrapper and gating');
let successes = 0;
async function success(path, target = app) {
  const before = store.get('usage:rail:rapidapi-bypass') ?? 0;
  const r = await request(path, secret, target); assert.equal(r.status, 200);
  const body = await r.json();
  const route = path.startsWith('/chain/wallet') ? '/chain/wallet' : gasPath;
  for (const validate of validators[route]) assert.ok(validate(body), JSON.stringify(validate.errors));
  if (!path.endsWith('/preview')) { successes++; assert.equal(store.get('usage:rail:rapidapi-bypass'), before + 1); }
  else assert.equal(store.get('usage:rail:rapidapi-bypass') ?? 0, before);
  return body;
}
async function failure(path, expected = 502, target = app) {
  const before = JSON.stringify([...store]);
  const r = await request(path, secret, target); assert.equal(r.status, expected);
  const body = await r.json(); assert.deepEqual(Object.keys(body), ['error']); assert.equal(typeof body.error, 'string');
  assert.equal(JSON.stringify([...store]), before, 'failure must not count success');
}
// Each cold module has its own USD cache; fixture state and fetch remain test-owned.
async function fresh(label) { return (await import(`../src/index.ts?${label}`)).default; }
reset({ usd: 'throw' });
const cold = await fresh('cold');
assert.equal((await success(gasPath, cold)).gas_price_usd, null);
assert.equal((await success(walletPath, cold)).balance_usd, null);
reset();
assert.equal((await success(walletPath, cold)).balance_usd, 2000);
reset({ usd: 'bad' });
const malformedUsd = await fresh('malformed-usd');
assert.equal((await success(gasPath, malformedUsd)).gas_price_usd, null);
assert.equal((await success(walletPath, malformedUsd)).balance_usd, null);
reset();
assert.equal((await success(walletPath, malformedUsd)).balance_usd, 2000);
reset();
for (const value of ['0x0', '0x144c4dd', `0x${'f'.repeat(64)}`]) {
  reset({ gas: value });
  const paid = await success(gasPath);
  const preview = await success(`${gasPath}/preview`);
  const { note, ...plain } = preview;
  assert.equal(typeof note, 'string'); assert.deepEqual(plain, paid);
  assert.equal(paid.gas_price_wei, BigInt(value).toString());
  assert.equal(paid.gas_price_gwei, Number(BigInt(value)) / 1e9);
  assert.equal(paid.base_fee_gwei, 0.018);
  assert.equal(paid.priority_fee_gwei, 0.0032);
}
for (const fee of [null, {}, 'throw', { baseFeePerGas: ['junk'], reward: [['0x1']] }, { baseFeePerGas: [`0x${'f'.repeat(300)}`], reward: [['0x1']] }]) {
  reset({ fee }); const body = await success(gasPath);
  assert.equal(body.base_fee_gwei, null);
  await success(`${gasPath}/preview`);
  reset(); await success(gasPath);
}
for (const gas of [null, false, 1, '', '12', '-1', '0x', '0x-1', '0x1oops', `0x${'f'.repeat(300)}`]) {
  reset({ gas }); await failure(gasPath); await failure(`${gasPath}/preview`);
  reset(); await success(gasPath); await success(`${gasPath}/preview`);
}
for (const path of ['/chain/wallet', '/chain/wallet?address=bad']) {
  await failure(path, 400); reset(); await success(walletPath);
}
for (const [balance, nonce] of [['0x0', '0x0'], ['0xde0b6b3a7640000', '0x4'], [`0x${'f'.repeat(64)}`, '0x1fffffffffffff']]) {
  for (const code of ['0x', '0x60006000', `0xef0100${address.slice(2)}`]) {
    reset({ balance, nonce, code }); const body = await success(walletPath);
    assert.equal(body.address, address); assert.equal(body.balance_wei, BigInt(balance).toString());
    assert.equal(body.tx_count, Number(BigInt(nonce)));
    assert.equal(body.is_contract, code === '0x60006000');
    assert.equal(body.is_eip7702_delegate, code.startsWith('0xef0100'));
    assert.equal(body.delegate_address, code.startsWith('0xef0100') ? address : null);
  }
}
for (const extra of [
  ...[null, false, 1, '', '1', '-1', '0x', '0x1z', `0x${'f'.repeat(300)}`].map(balance => ({ balance })),
  ...[null, false, 2, '', '0x', '0x1junk', '-1', '0x20000000000000'].map(nonce => ({ nonce })),
  ...[null, false, 42, '', '0x0', '0xgg', '0xef0100', `0xef0100${address.slice(2)}00`].map(code => ({ code })),
  { down: true },
]) {
  reset(extra); await failure(walletPath); reset(); await success(walletPath);
}
reset({ down: true }); await failure(gasPath); await failure(`${gasPath}/preview`); reset(); await success(gasPath);
// Warm cache hit, then expired-cache upstream failure retains the last good price.
const warm = await fresh('warm'); reset(); assert.equal((await success(walletPath, warm)).balance_usd, 2000);
const now = Date.now; Date.now = () => now() + 31000;
try {
  reset({ usd: 'throw' });
  assert.equal((await success(walletPath, warm)).balance_usd, 2000);
  assert.ok((await success(gasPath, warm)).gas_price_usd > 0);
} finally { Date.now = now; }
// Overflow of optional enrichment degrades to null; primary amounts remain finite.
const overflow = await fresh('overflow'); reset({ usd: 1e308, balance: `0x${'f'.repeat(64)}`, gas: `0x${'f'.repeat(64)}` });
assert.equal((await success(walletPath, overflow)).balance_usd, null);
assert.equal((await success(gasPath, overflow)).gas_price_usd, null);
assert.equal(store.get('usage:rail:rapidapi-bypass'), successes);
assert.equal([...store.keys()].some(k => k.startsWith('usage:paid:') || k.startsWith('usage:ts:')), false);
assert.deepEqual(unexpected, []);
console.log(`all sibling output-contract tests passed (${successes} synthetic successes; failure/recovery and preview cases)`);
