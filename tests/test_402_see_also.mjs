/**
 * Contract test for the in-protocol 402 see_also cross-sell.
 *
 *   node tests/test_402_see_also.mjs
 *
 * The per-request 402 payment-required body is the only surface 100% of paying
 * agents fetch before they pay. buildSeeAlso injects an additive, demand-ordered
 * upsell there: a DATA buyer is pointed at the 10x-value flagship safety verdict
 * (the ROUTE_CATALOG row tagged both "security" and "verdict" = /chain/token-report
 * today) plus one top-external-demand data sibling; a SECURITY buyer is never
 * nudged safety→safety and never sees itself. No path is a literal — the target
 * is tag-derived and the sibling order comes from the same DEMAND_SNAPSHOT signal
 * that drives the discovery manifest (zzzdm). Unknown routes inject nothing
 * (fail-closed); a malformed snapshot degrades open (no throw). This locks the
 * contract against the real exports. cloudflare:workers is shimmed by
 * cfw-hooks.mjs; Node >= 22.18 strips the TS types on import.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { buildSeeAlso, ROUTE_CATALOG } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// The tag-derived flagship safety target, resolved the same way the code does
// (never a path literal in the assertions either).
const flagshipRow = ROUTE_CATALOG.find((r) => {
  const t = r[5] || [];
  return t.includes("security") && t.includes("verdict");
});
ok(flagshipRow, "a ROUTE_CATALOG row is tagged both security AND verdict (the flagship)");
const FLAGSHIP = flagshipRow[0];

// --- (a) a DATA route gets the flagship safety upsell -----------------------
{
  const s = buildSeeAlso("/defi/yields", "https://x.test");
  ok(Array.isArray(s) && s.length >= 1, "data route /defi/yields yields a non-empty see_also");
  ok(s.length <= 2, "a data route see_also is capped at 2");
  const resources = s.map((e) => e.resource);
  ok(resources.includes("https://x.test" + FLAGSHIP), "the flagship safety verdict is present for a data buyer");
  const flag = s.find((e) => e.resource === "https://x.test" + FLAGSHIP);
  eq(flag.resource, "https://x.test" + FLAGSHIP, "flagship resource is origin-prefixed");
  ok(typeof flag.price_usdc === "string" && Number(flag.price_usdc) > 0, "flagship carries a positive price");
  ok(flag.preview === "https://x.test" + FLAGSHIP + "/preview", "flagship carries its free /preview pointer");
  ok(flag.description && flag.description.length <= 141, "flagship description is a trimmed short string");
}

// --- (b) a SECURITY route never upsells itself or safety→safety --------------
{
  const s = buildSeeAlso(FLAGSHIP, "https://x.test");
  const resources = s.map((e) => e.resource);
  eq(resources.filter((r) => r === "https://x.test" + FLAGSHIP).length, 0, "a security route never lists itself");
  // No entry that is itself a security-verdict route (no safety→safety nudge).
  for (const e of s) {
    const row = ROUTE_CATALOG.find((r) => "https://x.test" + r[0] === e.resource);
    const t = (row && row[5]) || [];
    ok(!(t.includes("security") && t.includes("verdict")), `security caller never upsells another safety-verdict route (${e.resource})`);
  }
  ok(s.length <= 1, "a security caller is capped at one cross-lane data sibling");
}

// --- (c) self never appears in its own see_also, for EVERY catalog route -----
{
  let selfHits = 0;
  for (const [path] of ROUTE_CATALOG) {
    const s = buildSeeAlso(path, "https://x.test");
    for (const e of s) if (e.resource === "https://x.test" + path) selfHits++;
  }
  eq(selfHits, 0, "no route ever upsells itself across the whole catalog");
}

// --- (d) the sibling is ordered by the demand snapshot (not catalog order) ---
{
  // Stub a snapshot that makes /chain/gas-price the dominant data sibling.
  const stub = { "/chain/gas-price": 99, "/defi/fees-top": 1 };
  const s = buildSeeAlso("/crypto/prices", "https://x.test", ROUTE_CATALOG, stub);
  // The data sibling (the non-flagship entry) must be the highest-demand data route.
  const sibling = s.find((e) => e.resource !== "https://x.test" + FLAGSHIP);
  ok(sibling, "a data sibling is present alongside the flagship");
  eq(sibling.resource, "https://x.test/chain/gas-price", "sibling follows the demand snapshot order");
}

// --- (e) degrade-open: unknown route + malformed snapshot never throw --------
{
  eq(buildSeeAlso("/not/a/real/route", "https://x.test").length, 0, "unknown route injects nothing (fail-closed)");
  let threw = false;
  try {
    // @ts-ignore deliberately malformed snapshot
    buildSeeAlso("/defi/yields", "https://x.test", ROUTE_CATALOG, null);
  } catch { threw = true; }
  ok(!threw, "a null/garbage snapshot degrades open (no throw)");
  // And it still produces the flagship upsell from the real default demand.
  ok(buildSeeAlso("/defi/yields", "https://x.test").some((e) => e.resource === "https://x.test" + FLAGSHIP),
    "default-snapshot path still surfaces the flagship");
}

console.log(`\n✓ 402 see_also contract: ${pass} checks passed`);
