/**
 * Contract test for the 200-envelope see_also cross-sell.
 *
 *   node tests/test_200_see_also.mjs
 *
 * An x402 buyer client auto-pays the 402 inside its payment middleware, so the
 * paying agent's reasoning loop only ever parses the 200 JSON it requested —
 * never the 402 body. injectSeeAlso mirrors the SAME demand-ordered buildSeeAlso
 * upsell onto that 200 body under an additive namespaced `_greyridge.see_also`
 * key. This locks the contract against the real export: additive (no field the
 * buyer asked for moves), only plain JSON objects of known catalog routes, and
 * degrade-open on everything else (arrays/primitives/malformed/unknown route).
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { injectSeeAlso, buildSeeAlso, ROUTE_CATALOG } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

const flagshipRow = ROUTE_CATALOG.find((r) => {
  const t = r[5] || [];
  return t.includes("security") && t.includes("verdict");
});
ok(flagshipRow, "a ROUTE_CATALOG row is tagged both security AND verdict (the flagship)");
const FLAGSHIP = flagshipRow[0];

// --- (a) a DATA route 200 body gets the namespaced see_also -----------------
{
  const body = JSON.stringify({ chain: "base", data: [1, 2, 3], count: 3 });
  const out = injectSeeAlso(body, "/defi/yields", "https://x.test");
  const parsed = JSON.parse(out);
  // Original fields are preserved exactly.
  eq(parsed.chain, "base", "original field `chain` preserved");
  eq(parsed.count, 3, "original field `count` preserved");
  assert.deepStrictEqual(parsed.data, [1, 2, 3], "original field `data` preserved"); pass++;
  // The cross-sell is present and matches buildSeeAlso for the same route.
  ok(parsed._greyridge && Array.isArray(parsed._greyridge.see_also), "_greyridge.see_also array injected");
  const expect = buildSeeAlso("/defi/yields", "https://x.test");
  assert.deepStrictEqual(parsed._greyridge.see_also, expect, "injected see_also equals buildSeeAlso output"); pass++;
  ok(parsed._greyridge.see_also.some((e) => e.resource === "https://x.test" + FLAGSHIP),
    "a data buyer sees the 10x flagship safety verdict in the 200 body");
}

// --- (b) a SECURITY route 200 body gets its capped cross-lane sibling -------
{
  const body = JSON.stringify({ verdict: "SAFE", risk_score: 15 });
  const out = injectSeeAlso(body, FLAGSHIP, "https://x.test");
  const parsed = JSON.parse(out);
  eq(parsed.verdict, "SAFE", "security route original `verdict` preserved");
  ok(parsed._greyridge && parsed._greyridge.see_also.length <= 1, "security caller capped at one sibling in 200 body");
  eq(parsed._greyridge.see_also.filter((e) => e.resource === "https://x.test" + FLAGSHIP).length, 0,
    "security route never upsells itself in the 200 body");
}

// --- (c) degrade-open: non-catalog route is left byte-for-byte --------------
{
  const body = JSON.stringify({ ok: true, facilitator: "xpay" });
  eq(injectSeeAlso(body, "/health", "https://x.test"), body, "unknown/non-catalog route body unchanged (fail-closed)");
  eq(injectSeeAlso(body, "/not/a/real/route", "https://x.test"), body, "nonexistent route body unchanged");
}

// --- (d) degrade-open: arrays / primitives / malformed pass through ---------
{
  const arr = JSON.stringify([{ a: 1 }, { b: 2 }]);
  eq(injectSeeAlso(arr, "/defi/yields", "https://x.test"), arr, "array body is not reshaped (passes through)");
  eq(injectSeeAlso("42", "/defi/yields", "https://x.test"), "42", "primitive JSON body passes through");
  eq(injectSeeAlso("not json {", "/defi/yields", "https://x.test"), "not json {", "malformed body passes through (no throw)");
  eq(injectSeeAlso("null", "/defi/yields", "https://x.test"), "null", "JSON null passes through");
}

// --- (e) idempotent: never double-inject ------------------------------------
{
  const body = JSON.stringify({ chain: "base" });
  const once = injectSeeAlso(body, "/defi/yields", "https://x.test");
  const twice = injectSeeAlso(once, "/defi/yields", "https://x.test");
  eq(twice, once, "re-injecting an already-injected body is a no-op (idempotent)");
  eq(JSON.parse(twice)._greyridge.see_also.length, JSON.parse(once)._greyridge.see_also.length,
    "no second _greyridge nesting on re-inject");
}

// --- (f) never throws, for EVERY catalog route ------------------------------
{
  let threw = false;
  for (const [path] of ROUTE_CATALOG) {
    try {
      const out = injectSeeAlso(JSON.stringify({ x: 1 }), path, "https://x.test");
      JSON.parse(out); // output is always valid JSON
    } catch { threw = true; }
  }
  ok(!threw, "injectSeeAlso never throws and always emits valid JSON across the whole catalog");
}

// --- (g) a free /preview path resolves to its paid parent and cross-sells ----
// The warm-lead leak fix: previews ride the same traffic as the paid parent but
// were never in ROUTE_CATALOG, so used to fail-closed at $0. A preview must now
// carry the SAME cross-sell as its parent, and must NEVER upsell the parent to
// itself (the existing same-route note already points there).
{
  const parent = buildSeeAlso("/defi/yields", "https://x.test");
  const prev = buildSeeAlso("/defi/yields/preview", "https://x.test");
  ok(prev.length > 0, "a /preview path yields a non-empty cross-sell (no longer $0 leak)");
  assert.deepStrictEqual(prev, parent, "a /preview carries the SAME see_also as its paid parent"); pass++;
  eq(prev.filter((e) => e.resource === "https://x.test/defi/yields").length, 0,
    "a /preview never upsells its own paid parent (not self)");
  // Injected onto a real preview-shaped body, original fields survive.
  const body = JSON.stringify({ preview: [{ pool: "x" }], total_available: 20, note: "sample" });
  const parsed = JSON.parse(injectSeeAlso(body, "/defi/yields/preview", "https://x.test"));
  eq(parsed.note, "sample", "preview body `note` preserved under injection");
  ok(Array.isArray(parsed.preview) && parsed._greyridge.see_also.length > 0,
    "preview body keeps its data AND gains _greyridge.see_also");
}

// --- (h) same-family proprietary UPGRADE leads the data cross-sell -----------
// A /defi/yields caller's warmest upgrade is the proprietary per-pool verdict
// (/defi/yield-entry-verdict) — same family, a DECISION verdict, priced higher —
// NOT a generic cross-lane sibling. Asserted by PROPERTY so it is rename/retag
// proof: the first entry shares a specific family tag, is priced above the
// source route, and carries a verdict/decision character.
{
  const DECISION = new Set(["verdict", "due-diligence", "risk"]);
  const GENERIC = new Set(["data", "defi", "crypto", "chain", "market-data"]);
  const srcRow = ROUTE_CATALOG.find((r) => r[0] === "/defi/yields");
  const srcFamily = (srcRow[5] || []).filter((t) => !GENERIC.has(t));
  const srcPrice = parseFloat(srcRow[2]);
  const se = buildSeeAlso("/defi/yields", "https://x.test");
  ok(se.length >= 1, "a /defi/yields caller gets at least one cross-sell");
  const lead = se[0];
  const leadRow = ROUTE_CATALOG.find((r) => "https://x.test" + r[0] === lead.resource);
  ok(leadRow, "lead cross-sell resolves to a real catalog row");
  const leadTags = leadRow[5] || [];
  ok(leadTags.some((t) => DECISION.has(t)), "lead cross-sell is a DECISION/verdict route (the moat tier)");
  ok(leadTags.some((t) => srcFamily.includes(t)), "lead cross-sell shares a SPECIFIC family tag with /defi/yields");
  ok(parseFloat(lead.price_usdc) > srcPrice, "lead cross-sell is priced above the previewed route (10x capture)");
  ok(typeof lead.preview === "string" && lead.preview.endsWith("/preview"),
    "the verdict upgrade advertises its own free /preview try-surface");
}

console.log(`\n✓ 200-envelope see_also contract: ${pass} checks passed`);
