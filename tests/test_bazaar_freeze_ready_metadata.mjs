/**
 * Freeze-ready Bazaar metadata contract.
 *
 *   node tests/test_bazaar_freeze_ready_metadata.mjs
 *
 * WHY: measured 2026-11-06 against the live CDP x402 Bazaar — CDP captures a
 * route's `serviceName` + `description` ONCE (at first settlement) and never
 * re-reads them; only quality (calls/payers/lastCalledAt) refreshes afterward.
 * Proof: /defi/yields still shows its pre-override frozen title ("Top DeFi
 * Yields & APY") though the live 402 now emits a newer verdict-first copy. So a
 * route that is still UNINDEXED (never settled) will FREEZE with whatever its
 * live 402 emits at first settlement. If that is a generic path-derived name
 * with no buyer-query noun, it freezes thin and never ranks for the lane rivals
 * own — a permanent, silent own-goal.
 *
 * This test is the loud-failure guard: it asserts the named-demand moat routes
 * resolve to a buyer-query-matched serviceName (not the bare path-derived
 * fallback) and carry curated tags, and that EVERY override obeys the CDP
 * schema caps (serviceName <=32 printable-ASCII; <=5 tags, each <=32 ASCII).
 * If a refactor drops an override, this fails at CI time instead of silently
 * freezing a route thin where no public endpoint can reveal the damage.
 *
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { bazaarServiceNameFor, bazaarTagsFor } = await import("../src/index.ts");

const isAscii32 = (s) => typeof s === "string" && s.length >= 1 && s.length <= 32 && /^[\x20-\x7e]+$/.test(s);

// Named-demand lanes where a rival owns the CDP slot and we have a measured,
// superior product. Each MUST freeze with its buyer-query noun in the title.
// { routeKey -> a lowercase noun that must appear in the resolved serviceName }
const MOAT = {
  "GET /defi/yield-entry-verdict": "verdict",
  "GET /defi/yield-rotation": "rotate",
  "GET /x402/receipt-verify": "receipt",
  "GET /x402/cert": "certificate",
  "GET /security/epss-movers": "exploit",
  "GET /enrich/domain": "domain",
  // already-shipped lanes — lock them so they never regress to the fallback
  "GET /chain/wallet-screen": "sanctions",
  "GET /chain/token-report": "rug check",
  "GET /crypto/funding": "funding",
};

let checked = 0;
for (const [key, noun] of Object.entries(MOAT)) {
  const svc = bazaarServiceNameFor(key);
  const tags = bazaarTagsFor(key);
  assert.ok(isAscii32(svc), `${key}: serviceName "${svc}" must be 1..32 printable-ASCII chars`);
  assert.ok(
    svc.toLowerCase().includes(noun),
    `${key}: serviceName "${svc}" must carry the buyer-query noun "${noun}" (else it freezes thin and never ranks for that lane)`,
  );
  assert.ok(Array.isArray(tags) && tags.length >= 1 && tags.length <= 5, `${key}: 1..5 tags, got ${tags.length}`);
  for (const t of tags) assert.ok(isAscii32(t), `${key}: tag "${t}" must be 1..32 printable-ASCII chars`);
  checked++;
}

// A route with NO override must still degrade to a non-empty, schema-valid name
// (never null/empty — CDP drops null serviceName from the searchable index).
for (const key of ["GET /chain/gas-price", "GET /whois", "GET /dns"]) {
  const svc = bazaarServiceNameFor(key);
  assert.ok(isAscii32(svc), `${key}: fallback serviceName "${svc}" must be 1..32 printable-ASCII chars`);
}

console.log(`ok - freeze-ready Bazaar metadata: ${checked} moat routes carry query-noun serviceName + schema-valid tags`);
