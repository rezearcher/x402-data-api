/**
 * Contract tests for resolveTokenQuery — the ONE resolver shared by the paid
 * x402 routes, the free previews and the discovery surfaces (src/index.ts).
 *
 *   node tests/test_alias_resolution.mjs
 *
 * Regression under test (t_53e0754d): on production the 402 body for
 * /chain/token-report?token=USDC advertised the canonical address in
 * extensions.bazaar.info.input.queryParams.token, but the paid handler then
 * 400'd the retried alias with "token query param must be a 0x-prefixed 20-byte
 * address". Settlement is skipped on non-2xx, so nothing was charged, but the
 * demo / first-dollar funnel was unpassable: an agent that negotiated payment by
 * reading the manifest could never receive the product.
 *
 * These assertions pin, against the REAL exported Worker module (same
 * cfw-hooks type-stripping loader the notional / sized_verdict suites use):
 *   1. alias -> canonical address parity for USDC, WETH, cbETH (and the rest),
 *      case-insensitively — i.e. ?token=USDC == ?token=0x8335…2913;
 *   2. raw addresses pass through untouched (case preserved, no checksum games);
 *   3. genuinely unknown symbols still fail closed (handler 400, no settle);
 *   4. manifest-vs-handler parity: every paid route whose 402 body advertises a
 *      `token` query sample advertises a value this very resolver accepts, and
 *      that value is the table's canonical USDC — one table, no drift.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { resolveTokenQuery, DEMO_TOKEN_ALIASES, DEMO_TOKEN_ALIAS_HINT, makeRoutes } =
  await import("../src/index.ts");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

// Addresses verified on Base mainnet by eth_call symbol()/decimals() (2026-10-28).
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const CBETH = "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22";
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";

// ---------------------------------------------------------------------------
// 1. Alias parity — the paid handler must resolve exactly what the manifest
//    advertised. USDC / WETH / cbETH are the card's named cases.
// ---------------------------------------------------------------------------
check("?token=USDC resolves to canonical USDC (the value the 402 advertises)", () => {
  const r = resolveTokenQuery("USDC");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.token, USDC);
  assert.strictEqual(r.alias, true);
});

check("?token=weth resolves to canonical WETH", () => {
  const r = resolveTokenQuery("weth");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.token, WETH);
  assert.strictEqual(r.alias, true);
});

check("?token=cbETH resolves to canonical cbETH (case-insensitive)", () => {
  for (const q of ["cbETH", "cbeth", "CBETH", "CbEth"]) {
    const r = resolveTokenQuery(q);
    assert.strictEqual(r.ok, true, `alias ${q} must resolve`);
    assert.strictEqual(r.token, CBETH, `alias ${q} must map to cbETH`);
  }
});

check("mixed-case and padded aliases resolve (trim + lowercase)", () => {
  assert.strictEqual(resolveTokenQuery("  UsDc  ").token, USDC);
  assert.strictEqual(resolveTokenQuery("CbBtC").token, CBBTC);
  assert.strictEqual(resolveTokenQuery("AERO").token, AERO);
  assert.strictEqual(resolveTokenQuery("Degen").token, DEGEN);
});

check("alias->address table matches the on-chain-verified constants", () => {
  assert.deepStrictEqual(
    { ...DEMO_TOKEN_ALIASES },
    { usdc: USDC, weth: WETH, cbbtc: CBBTC, cbeth: CBETH, aero: AERO, degen: DEGEN },
  );
});

check("every alias appears in the error hint (hint cannot go stale)", () => {
  const hint = DEMO_TOKEN_ALIAS_HINT.split("|");
  assert.deepStrictEqual(hint.sort(), Object.keys(DEMO_TOKEN_ALIASES).sort());
});

check("every table value is a well-formed 20-byte address, all distinct", () => {
  const addrs = Object.values(DEMO_TOKEN_ALIASES).map((a) => a.toLowerCase());
  for (const a of addrs) assert.match(a, /^0x[0-9a-f]{40}$/);
  assert.strictEqual(new Set(addrs).size, addrs.length, "duplicate address in the alias table");
});

// ---------------------------------------------------------------------------
// 2. Address pass-through — an explicit contract address is never rewritten.
// ---------------------------------------------------------------------------
check("raw address passes through byte-for-byte (case preserved)", () => {
  const r = resolveTokenQuery(USDC);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.token, USDC);
  assert.strictEqual(r.alias, false, "a raw address is not an alias");
  const lower = USDC.toLowerCase();
  assert.strictEqual(resolveTokenQuery(lower).token, lower, "lowercase address must not be checksummed");
});

check("alias and its address are behaviourally identical (same token)", () => {
  for (const [alias, addr] of Object.entries(DEMO_TOKEN_ALIASES)) {
    assert.strictEqual(
      resolveTokenQuery(alias).token,
      resolveTokenQuery(addr).token,
      `${alias} and ${addr} must resolve to the same token`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Fail closed — unknown symbols must stay a 400 (and never settle).
// ---------------------------------------------------------------------------
check("token=notatoken fails closed with a helpful error", () => {
  const r = resolveTokenQuery("notatoken");
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /token must be a 0x-prefixed 20-byte Base address/);
  assert.ok(r.error.includes("usdc"), "error must name the accepted aliases");
});

check("malformed / empty / absent token values fail closed", () => {
  for (const q of ["", "   ", undefined, "0x123", "0xZZZ", USDC + "00", "usdcx", "cbeth "]) {
    const r = resolveTokenQuery(q);
    if (q === "cbeth ") {
      // trailing space is trimmed, so this one legitimately resolves — assert that
      assert.strictEqual(r.ok, true);
      continue;
    }
    assert.strictEqual(r.ok, false, `value ${JSON.stringify(q)} must be rejected`);
  }
});

check("lookalike aliases that are not in the table are rejected (e.g. cbeth2)", () => {
  for (const q of ["cbeth2", "usd", "weth9", "aeroo", "dai", "usdt"]) {
    assert.strictEqual(resolveTokenQuery(q).ok, false, `${q} must not resolve`);
  }
});

// ---------------------------------------------------------------------------
// 4. Manifest-vs-handler parity, read from the REAL x402 route configs that
//    build the 402 body (extensions.bazaar.info.input.queryParams.token).
// ---------------------------------------------------------------------------
const routes = makeRoutes("0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10");
const TOKEN_ROUTES = [
  "GET /chain/token-report",
  "GET /chain/token-security",
  "GET /gate/swap",
  "GET /chain/erc20-meta",
  "GET /chain/total-supply",
  "GET /chain/token-balance",
  "GET /chain/allowance",
];
const advertisedToken = (routeKey) =>
  routes[routeKey]?.extensions?.bazaar?.info?.input?.queryParams?.token;

check("every paid token route advertises a token the handler accepts", () => {
  for (const key of TOKEN_ROUTES) {
    const adv = advertisedToken(key);
    assert.ok(adv !== undefined, `${key} must advertise input.queryParams.token`);
    const r = resolveTokenQuery(adv);
    assert.strictEqual(r.ok, true, `${key} advertises ${adv} but the resolver rejects it`);
    assert.strictEqual(r.token, adv, `${key} advertised value must round-trip unchanged`);
  }
});

check("manifest sample is the shared table's USDC, not a second literal copy", () => {
  for (const key of TOKEN_ROUTES) {
    assert.strictEqual(
      advertisedToken(key),
      DEMO_TOKEN_ALIASES.usdc,
      `${key} must advertise DEMO_TOKEN_ALIASES.usdc`,
    );
    assert.strictEqual(advertisedToken(key), resolveTokenQuery("USDC").token);
  }
});

check("USDC / WETH / cbETH: handler resolution == what the manifest advertises", () => {
  const adv = advertisedToken("GET /chain/token-report");
  assert.strictEqual(resolveTokenQuery("USDC").token, adv);
  // The alias must land on the same contract the live route analysis reads.
  assert.strictEqual(resolveTokenQuery("WETH").token, WETH);
  assert.strictEqual(resolveTokenQuery("cbETH").token, CBETH);
});

console.log(`\nPASS — ${pass} alias-resolution contract checks`);
