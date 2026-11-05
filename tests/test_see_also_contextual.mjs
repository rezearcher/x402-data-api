/**
 * Contract test for the contextual (deep-linked) see_also cross-sell.
 *
 *   node tests/test_see_also_contextual.mjs
 *
 * The output of a data route (a /defi/yields pool id) must become the INPUT to
 * its proprietary verdict upsell: contextualizeSeeAlso carries the exact
 * identifier the current response surfaced into the verdict link, so an agent
 * gets a ONE-CLICK go/no-go on the pool it is actually looking at — the
 * connection that converts the warm lead. Pure, degrade-open, never drops or
 * reorders an entry, and never lets a body value inject an extra URL param.
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { contextualizeSeeAlso, buildSeeAlso, injectSeeAlso, ROUTE_CATALOG } =
  await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

const POOL = "747c1d2a-c668-4682-b9f9-296708a3dd90";

// --- (a) the verdict entry gets deep-linked with the surfaced pool id --------
{
  const se = buildSeeAlso("/defi/yields", "https://x.test");
  const verdict = se.find((e) => e.resource.endsWith("/defi/yield-entry-verdict"));
  ok(verdict, "baseline cross-sell includes the per-pool yield-entry-verdict");
  ok(/\?pool=/.test(verdict.description), "verdict entry description advertises a ?pool= param");

  const body = { preview: [{ project: "lido", pool: POOL, apy: 2.27 }], total_available: 20 };
  const out = contextualizeSeeAlso(se, body);
  const v2 = out.find((e) => e.resource.includes("/defi/yield-entry-verdict"));
  eq(v2.resource, `https://x.test/defi/yield-entry-verdict?pool=${POOL}`,
    "verdict resource now deep-links the exact pool the response surfaced");
  eq(v2.preview, `https://x.test/defi/yield-entry-verdict/preview?pool=${POOL}`,
    "verdict free-preview link also carries the pool (one-click free sample)");
  ok(v2.description.startsWith("Go/no-go on the top result above"),
    "description leads with the decision-layer action");
}

// --- (b) entries that take no ?param= are left generic -----------------------
{
  const se = buildSeeAlso("/defi/yields", "https://x.test");
  const body = { preview: [{ pool: POOL }], total_available: 1 };
  const out = contextualizeSeeAlso(se, body);
  for (const e of out) {
    if (!/[?&][A-Za-z_][A-Za-z0-9_]*=/.test(e.description)) {
      ok(!e.resource.includes("?"), `a no-param cross-sell (${e.resource}) stays generic`);
    }
  }
  eq(out.length, se.length, "no entry is dropped or added by contextualization");
}

// --- (c) degrade-open: no matching field → unchanged -------------------------
{
  const se = buildSeeAlso("/defi/yields", "https://x.test");
  // rows carry NO `pool` field → the verdict upsell cannot be deep-linked.
  const body = { preview: [{ project: "lido", apy: 2.27 }] };
  const out = contextualizeSeeAlso(se, body);
  assert.deepStrictEqual(out, se, "no pool field present → see_also returned byte-for-byte"); pass++;
}

// --- (d) degrade-open: empty / non-row bodies --------------------------------
{
  const se = buildSeeAlso("/defi/yields", "https://x.test");
  assert.deepStrictEqual(contextualizeSeeAlso(se, {}), se, "empty object → unchanged"); pass++;
  assert.deepStrictEqual(contextualizeSeeAlso(se, null), se, "null body → unchanged"); pass++;
  assert.deepStrictEqual(contextualizeSeeAlso(se, { data: [1, 2, 3] }), se, "array of primitives → unchanged"); pass++;
  assert.deepStrictEqual(contextualizeSeeAlso([], { preview: [{ pool: POOL }] }), [], "empty see_also → empty"); pass++;
}

// --- (e) injection-safe: a hostile body value can't break the URL ------------
{
  const se = buildSeeAlso("/defi/yields", "https://x.test");
  const body = { preview: [{ pool: "abc&token=0xEVIL&x=../../etc" }] };
  const out = contextualizeSeeAlso(se, body);
  const v = out.find((e) => e.resource.includes("/defi/yield-entry-verdict"));
  ok(!v.resource.includes("&token="), "unsafe pool value is rejected — no extra param smuggled into the URL");
  eq(v.resource, "https://x.test/defi/yield-entry-verdict",
    "rejected value leaves the verdict resource generic (degrade-open)");
}

// --- (f) end-to-end: injectSeeAlso deep-links a real preview body ------------
{
  const body = JSON.stringify({ preview: [{ project: "lido", pool: POOL, apy: 2.27 }], total_available: 20, note: "sample" });
  const parsed = JSON.parse(injectSeeAlso(body, "/defi/yields/preview", "https://x.test"));
  eq(parsed.note, "sample", "preview body `note` preserved");
  const v = parsed._greyridge.see_also.find((e) => e.resource.includes("/defi/yield-entry-verdict"));
  ok(v && v.resource.endsWith(`?pool=${POOL}`),
    "the injected 200-body verdict cross-sell deep-links the surfaced pool");
}

// --- (g) never throws across arbitrary bodies --------------------------------
{
  let threw = false;
  const se = buildSeeAlso("/defi/yields", "https://x.test");
  for (const b of [undefined, 0, "", [], [{}], { preview: null }, { a: { pool: POOL } }]) {
    try { contextualizeSeeAlso(se, b); } catch { threw = true; }
  }
  ok(!threw, "contextualizeSeeAlso never throws on arbitrary body shapes");
}

console.log(`\n✓ contextual see_also deep-link contract: ${pass} checks passed`);
