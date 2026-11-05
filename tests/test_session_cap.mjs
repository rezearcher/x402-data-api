/**
 * Contract tests for session-cap billing (src/index.ts).
 *
 *   node tests/test_session_cap.mjs
 *
 * Session-cap billing collapses the per-call EIP-3009 signature for high-frequency
 * pollers: pay a USDC cap ONCE (a real on-chain settlement of the opener route),
 * then call any paid route behind an `X-Session-Token` debited at the route's listed
 * atomic price. These tests pin the pure, oracle-safe pieces:
 *   - the opener tiers exist in makeRoutes at the exact advertised prices,
 *   - routePriceAtomic resolves per-call debits (incl. :param paths) and returns
 *     null for free/unknown routes (so the gate never bypasses for free),
 *   - caps equal their opener price (buyer never over/under-credited).
 * cfw-hooks shims cloudflare:workers.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { makeRoutes, routePriceAtomic, usdcDollarsToAtomic, extractSessionToken } = await import("../src/index.ts");

const PAY_TO = "0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10";
const OTHER_PAYTO = "0x0000000000000000000000000000000000000001";

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`ok - ${name}`); }

const routes = makeRoutes(PAY_TO);

// 1. All three opener tiers are registered as PAID routes at their advertised price.
check("opener tiers exist at exact prices", () => {
  assert.strictEqual(routes["POST /x402/session"]?.accepts?.price, "$0.05", "small = $0.05");
  assert.strictEqual(routes["POST /x402/session/plus"]?.accepts?.price, "$0.50", "plus = $0.50");
  assert.strictEqual(routes["POST /x402/session/max"]?.accepts?.price, "$5.00", "max = $5.00");
});

// 2. Opener caps equal the opener price in atomic units (never over/under-credit).
check("cap atomic == opener price atomic", () => {
  assert.strictEqual(usdcDollarsToAtomic("$0.05"), 50000, "0.05 -> 50000");
  assert.strictEqual(usdcDollarsToAtomic("$0.50"), 500000, "0.50 -> 500000");
  assert.strictEqual(usdcDollarsToAtomic("$5.00"), 5000000, "5.00 -> 5000000");
});

// 3. routePriceAtomic resolves the per-call debit for a flat paid route.
check("routePriceAtomic resolves /defi/yields = 1000 (=$0.001)", () => {
  const p = routePriceAtomic("/defi/yields", "GET", PAY_TO);
  assert.strictEqual(p, 1000, `expected 1000, got ${p}`);
});

// 4. routePriceAtomic matches :param path routes (e.g. /dns/:domain).
check("routePriceAtomic matches a :param route", () => {
  const p = routePriceAtomic("/dns/example.com", "GET", PAY_TO);
  assert.strictEqual(p, 10000, `/dns/:domain = $0.01 = 10000, got ${p}`);
});

// 5. Unknown / free routes return null so the gate NEVER session-bypasses them.
check("routePriceAtomic returns null for unknown/free routes", () => {
  assert.strictEqual(routePriceAtomic("/not-a-route", "GET", PAY_TO), null, "unknown -> null");
  assert.strictEqual(routePriceAtomic("/defi/yields/preview", "GET", PAY_TO), null, "free preview -> null");
  assert.strictEqual(routePriceAtomic("/defi/yields", "DELETE", PAY_TO), null, "wrong method -> null");
});

// 6. Method is honoured: POST /mcp is priced, GET /mcp (SSE/free) is not a paid match.
check("routePriceAtomic honours method on /mcp", () => {
  assert.strictEqual(routePriceAtomic("/mcp", "POST", PAY_TO), 5000, "POST /mcp = $0.005 = 5000");
  assert.strictEqual(routePriceAtomic("/mcp", "GET", PAY_TO), null, "GET /mcp not a paid route");
});

// 7. Price cache keys on payTo: a different payTo recompiles (same prices, new table).
check("routePriceAtomic recompiles for a new payTo", () => {
  const a = routePriceAtomic("/defi/yields", "GET", PAY_TO);
  const b = routePriceAtomic("/defi/yields", "GET", OTHER_PAYTO);
  assert.strictEqual(a, b, "price is payTo-independent");
  // back to original payTo still resolves (cache swap didn't corrupt state)
  assert.strictEqual(routePriceAtomic("/defi/yields", "GET", PAY_TO), 1000);
});

// 8. A $0.50 cap covers ~500 calls at the /defi/yields price — the poller math.
check("cap covers expected call count", () => {
  const cap = usdcDollarsToAtomic("$0.50");
  const perCall = routePriceAtomic("/defi/yields", "GET", PAY_TO);
  assert.strictEqual(Math.floor(cap / perCall), 500, "0.50 cap / 0.001 = 500 calls");
});

// 9. extractSessionToken: the dedicated header wins and is returned verbatim.
check("extractSessionToken returns X-Session-Token verbatim", () => {
  assert.strictEqual(extractSessionToken("grsess_abc-DEF_123", undefined), "grsess_abc-DEF_123");
  // X-Session-Token takes precedence over Authorization when both are present.
  assert.strictEqual(extractSessionToken("grsess_x", "Bearer grsess_y"), "grsess_x");
});

// 10. extractSessionToken: a standard `Authorization: Bearer grsess_…` is accepted.
check("extractSessionToken parses Bearer grsess_ token", () => {
  assert.strictEqual(extractSessionToken(undefined, "Bearer grsess_abc-DEF_123"), "grsess_abc-DEF_123");
  // case-insensitive scheme keyword
  assert.strictEqual(extractSessionToken(undefined, "bearer grsess_zzz"), "grsess_zzz");
});

// 11. extractSessionToken: non-session Bearer credentials are IGNORED (fall through).
check("extractSessionToken ignores non-grsess Bearer + junk", () => {
  assert.strictEqual(extractSessionToken(undefined, "Bearer eyJhbGciOiJIUzI1NiJ9.jwt.sig"), undefined, "JWT ignored");
  assert.strictEqual(extractSessionToken(undefined, "Bearer sk_live_apikey"), undefined, "api key ignored");
  assert.strictEqual(extractSessionToken(undefined, "grsess_nobearerscheme"), undefined, "no Bearer scheme -> ignored");
  assert.strictEqual(extractSessionToken(undefined, undefined), undefined, "no headers -> undefined");
  assert.strictEqual(extractSessionToken(null, null), undefined, "null headers -> undefined");
});

console.log(`\n${pass} checks passed`);
