/**
 * Contract test for the /defi/yields project filter family-name match.
 *
 *   node tests/test_defi_yields_project_family.mjs
 *
 * /defi/yields is the single most-paid external route (5 of 11 distinct payers,
 * payer trace 30d). DefiLlama namespaces protocols as "<family>-<version>"
 * (aave-v3, uniswap-v2, curve-dex), so an agent filtering by the human protocol
 * name (project=aave) used to get an empty array on a route it PAID for -> the
 * count=0 silent-success defect, a churned repeat customer. matchesProjectFamily
 * now resolves the family name to its versioned pools while staying precise
 * (trailing dash: "uni" must NOT match "uniswap") and degrade-open (a bogus name
 * still returns no match). This test locks that contract against the real export.
 * cloudflare:workers is shimmed by cfw-hooks.mjs. Node >= 22.18 strips types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { matchesProjectFamily, resolveProtocolFamily } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// The real failure we are fixing: human family name must resolve versioned slugs.
ok(matchesProjectFamily("aave-v3", "aave"), "aave resolves aave-v3");
ok(matchesProjectFamily("aave-v4", "aave"), "aave resolves aave-v4");
ok(matchesProjectFamily("uniswap-v2", "uniswap"), "uniswap resolves uniswap-v2");
ok(matchesProjectFamily("uniswap-v3", "uniswap"), "uniswap resolves uniswap-v3");
ok(matchesProjectFamily("curve-dex", "curve"), "curve resolves curve-dex");
ok(matchesProjectFamily("curve-llamalend", "curve"), "curve resolves curve-llamalend");
ok(matchesProjectFamily("compound-v3", "compound"), "compound resolves compound-v3");
ok(matchesProjectFamily("morpho-blue", "morpho"), "morpho resolves morpho-blue");

// Exact match (existing behavior) must be preserved, case-insensitively.
ok(matchesProjectFamily("lido", "lido"), "exact slug lido still matches");
ok(matchesProjectFamily("aave-v3", "AAVE"), "query is case-insensitive");
ok(matchesProjectFamily("Aave-V3", "aave"), "slug is case-insensitive");
ok(matchesProjectFamily("aave-v3", " aave "), "query is trimmed");

// Precision: a prefix WITHOUT a trailing dash must NOT over-match.
ok(!matchesProjectFamily("uniswap-v3", "uni"), "uni does NOT over-match uniswap");
ok(!matchesProjectFamily("aave-v3", "aav"), "aav does NOT over-match aave");
ok(!matchesProjectFamily("lido", "lid"), "lid does NOT over-match lido");

// Degrade-open: a bogus/unknown name still matches nothing (returns [] upstream).
ok(!matchesProjectFamily("aave-v3", "zzznotreal"), "bogus name matches nothing");
ok(!matchesProjectFamily("aave-v3", "uniswap"), "wrong family does not cross-match");

// Empty filter matches everything (no project query -> unfiltered).
ok(matchesProjectFamily("aave-v3", ""), "empty query matches all");

// --- /defi/protocol-risk family resolution (same convention, $0.01 route) ---
// protocol=aave must resolve the highest-TVL version instead of 404-ing.
const protos = [
  { slug: "aave-v3", tvl: 20e9 },
  { slug: "aave-v4", tvl: 1e9 },
  { slug: "uniswap-v3", tvl: 5e9 },
  { slug: "lido", tvl: 30e9 },
  { slug: "curve-dex", tvl: 2e9 },
];
ok(resolveProtocolFamily(protos, "aave")?.slug === "aave-v3", "protocol aave -> highest-TVL aave-v3");
ok(resolveProtocolFamily(protos, "uniswap")?.slug === "uniswap-v3", "protocol uniswap -> uniswap-v3");
ok(resolveProtocolFamily(protos, "curve")?.slug === "curve-dex", "protocol curve -> curve-dex");
ok(resolveProtocolFamily(protos, "aave-v4")?.slug === "aave-v4", "exact slug aave-v4 preserved");
ok(resolveProtocolFamily(protos, "lido")?.slug === "lido", "exact slug lido preserved");
ok(resolveProtocolFamily(protos, "AAVE")?.slug === "aave-v3", "protocol query case-insensitive");
ok(resolveProtocolFamily(protos, "uni") === undefined, "protocol uni does NOT over-match uniswap");
ok(resolveProtocolFamily(protos, "zzznotreal") === undefined, "bogus protocol -> undefined (404)");
ok(resolveProtocolFamily(protos, "") === undefined, "empty protocol -> undefined");

console.log(`defi_yields + protocol-risk family contract: ${pass}/${pass} checks passed`);
