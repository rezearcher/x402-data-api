/**
 * Contract tests for the OFAC wallet sanctions screen
 * (src/index.ts: screenWalletAddress + src/data/ofac_sanctioned.ts).
 *
 *   node tests/test_wallet_screen.mjs
 *
 * The screen is an EXACT match against a frozen, authoritative OFAC SDN
 * crypto-address snapshot — not a heuristic. Positive matches are "blocked";
 * non-matches are "clear" but NEVER asserted as safe (Claims Law). The route is
 * registered on both the 402 gate (makeRoutes) and the price catalog so the
 * advertised price equals the charged price.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { screenWalletAddress, makeRoutes, ROUTE_CATALOG } = await import("../src/index.ts");
const { OFAC_SANCTIONED_ADDRESSES, OFAC_SNAPSHOT_DATE } = await import("../src/data/ofac_sanctioned.ts");
const { MALICIOUS_ADDRESSES, MALICIOUS_SNAPSHOT_DATE } = await import("../src/data/malicious_addresses.ts");

let pass = 0;
function check(name, fn) { fn(); pass++; console.log(`ok - ${name}`); }

const _malSet = new Set(MALICIOUS_ADDRESSES);
// A real current SDN entry that is NOT also on the scam list (keeps the
// sanctioned-only assertions below unambiguous).
const SANCTIONED = OFAC_SANCTIONED_ADDRESSES.find((a) => !_malSet.has(a)) ?? OFAC_SANCTIONED_ADDRESSES[0];
const _ofacSet = new Set(OFAC_SANCTIONED_ADDRESSES);
// A real current scam/drainer entry that is NOT also sanctioned.
const MALICIOUS = MALICIOUS_ADDRESSES.find((a) => !_ofacSet.has(a)) ?? MALICIOUS_ADDRESSES[0];
const CLEAN = "0x5765ae06a52dc7a0bb71c36a11db512c7ea9ed10"; // our own PAY_TO (not sanctioned, not malicious)

// 1. The snapshot is non-empty and lowercased (match correctness depends on it).
check("snapshot is non-empty and all-lowercase", () => {
  assert.ok(OFAC_SANCTIONED_ADDRESSES.length > 0, "has entries");
  for (const a of OFAC_SANCTIONED_ADDRESSES) {
    assert.ok(/^0x[0-9a-f]{40}$/.test(a), `lowercased 0x addr: ${a}`);
  }
});

// 2. A sanctioned address -> blocked, with the OFAC-SDN list + flag.
check("sanctioned address is blocked", () => {
  const r = screenWalletAddress(SANCTIONED);
  assert.strictEqual(r.sanctioned, true);
  assert.strictEqual(r.verdict, "blocked");
  assert.deepStrictEqual(r.lists, ["OFAC-SDN"]);
  assert.ok(r.flags.includes("ofac-sdn-sanctioned"));
  assert.strictEqual(r.source.snapshot_date, OFAC_SNAPSHOT_DATE);
});

// 3. Case-insensitive: a CHECKSUMMED/uppercased sanctioned address still matches.
check("sanctioned match is case-insensitive", () => {
  const r = screenWalletAddress(SANCTIONED.toUpperCase().replace("0X", "0x"));
  assert.strictEqual(r.sanctioned, true, "uppercased form still matches");
  assert.strictEqual(r.address, SANCTIONED, "address normalized to lowercase in output");
});

// 4. A non-sanctioned address -> clear, but the disclaimer refuses to assert safety.
check("non-sanctioned address is clear and never asserted safe", () => {
  const r = screenWalletAddress(CLEAN);
  assert.strictEqual(r.sanctioned, false);
  assert.strictEqual(r.malicious, false);
  assert.strictEqual(r.verdict, "clear");
  assert.deepStrictEqual(r.lists, []);
  assert.deepStrictEqual(r.flags, []);
  assert.ok(/not a guarantee|not a safety|not safety|absence of a match is not safety/i.test(r.disclaimer),
    `disclaimer denies safety guarantee: ${r.disclaimer}`);
});

// 4b. A known scam/phishing/drainer address -> blocked via the malicious flag
//     (NOT the sanctioned flag) — closes the "sanctioned OR scammer" demand gap.
check("malicious (scam/drainer) address is blocked via the malicious flag", () => {
  assert.ok(MALICIOUS_ADDRESSES.length > 1000, "scam snapshot is non-trivial");
  const r = screenWalletAddress(MALICIOUS);
  assert.strictEqual(r.malicious, true, "flagged malicious");
  assert.strictEqual(r.sanctioned, false, "this fixture is scam-only, not OFAC");
  assert.strictEqual(r.verdict, "blocked");
  assert.ok(r.lists.includes("scam-phishing-drainer"), `lists: ${r.lists}`);
  assert.ok(r.flags.includes("malicious-address"), `flags: ${r.flags}`);
  assert.ok(/scam|phishing|drainer/i.test(r.reason), `reason names the threat: ${r.reason}`);
});

// 4c. Both snapshots appear in `sources` on every result (auditor-grade provenance),
//     and `source` stays the OFAC primary for back-compat.
check("result enumerates both OFAC + scam sources", () => {
  const r = screenWalletAddress(CLEAN);
  assert.ok(Array.isArray(r.sources) && r.sources.length === 2, "two sources");
  assert.ok(r.sources.some((s) => /OFAC/.test(s.name)), "OFAC source present");
  assert.ok(r.sources.some((s) => /scam|phishing|drainer/i.test(s.name)), "scam source present");
  const mal = r.sources.find((s) => /scam|phishing|drainer/i.test(s.name));
  assert.strictEqual(mal.snapshot_date, MALICIOUS_SNAPSHOT_DATE);
  assert.strictEqual(mal.entries, MALICIOUS_ADDRESSES.length);
  assert.ok(/OFAC/.test(r.source.name), "back-compat: source stays OFAC primary");
});

// 5. Provenance is present on every result (auditor-grade / Claims Law).
check("result carries authoritative source provenance", () => {
  const r = screenWalletAddress(CLEAN);
  assert.ok(/OFAC/.test(r.source.name));
  assert.ok(/Treasury/.test(r.source.authority));
  assert.strictEqual(r.source.entries, OFAC_SANCTIONED_ADDRESSES.length);
});

// 6. The route is in the price catalog at 0.003 and on the 402 gate (charged == advertised).
check("route is catalog-priced and 402-gated at the same price", () => {
  const cat = ROUTE_CATALOG.find(([p]) => p === "/chain/wallet-screen");
  assert.ok(cat, "present in ROUTE_CATALOG");
  assert.strictEqual(cat[2], "0.004", "catalog price (WTP floor)");
  const routes = makeRoutes("0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10");
  const gate = routes["GET /chain/wallet-screen"];
  assert.ok(gate && gate.accepts, "present on the 402 gate");
  assert.strictEqual(gate.accepts.price, "$0.004", "gate charged price == catalog price");
});

// 7. screenWalletAddress is pure (no RPC): two calls on the same input agree on verdict.
check("screen is deterministic (pure data match, no RPC)", () => {
  const a = screenWalletAddress(SANCTIONED);
  const b = screenWalletAddress(SANCTIONED);
  assert.strictEqual(a.verdict, b.verdict);
  assert.strictEqual(a.sanctioned, b.sanctioned);
});

console.log(`\n${pass} checks passed`);
