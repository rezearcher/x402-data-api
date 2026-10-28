/**
 * Contract test for the extracted, pure token-risk scorer.
 *
 *   node tests/test_token_risk_score.mjs
 *
 * computeTokenRiskScore is the single additive scorer behind all five
 * token-safety surfaces (paid /chain/token-security, its /preview, /gate/swap,
 * /chain/token-report, MCP tools/call). It was extracted inline-from
 * analyzeTokenSecurity so the blue-chip cry-wolf calibration lives in ONE
 * unit-tested place.
 *
 * The fix: a verified + demonstrably-sellable + near-zero-owner token (USDC,
 * cbBTC — the two assets every new payer tests the gate on first) stops
 * returning verdict=review on the mere EXISTENCE of admin capabilities, while
 * every honeypot / high-tax / insider-heavy / unverified token keeps its full
 * score. Dampening requires ALL THREE independent positive proofs and never
 * touches the honeypot-sim / fee-on-transfer / owner-concentration penalties —
 * so it is a calibration, not a false-SAFE downgrade. NO token-address list.
 * cloudflare:workers is shimmed by cfw-hooks.mjs; Node >= 22.18 strips TS types.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { computeTokenRiskScore, TOKEN_RISK_THRESHOLDS } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

// A blue-chip-shaped input: USDC/cbBTC — proxy + mint + blacklist + pause +
// owner-not-renounced = 65 static capability points, but verified source,
// a sell sim that passed, and the owner holding 0% of supply.
function bluechip(over = {}) {
  return {
    is_contract: true,
    sim: { sim_status: "tested", transferable: true, transfer_tax_bps: 0 },
    proxy: { is_proxy: true, proxy_standard: "OZ zOS AdminUpgradeabilityProxy (pre-EIP-1967)" },
    categories: { can_mint: true, has_blacklist: true, can_pause: true, has_fee_setter: false, has_ownership: true },
    owner: { ownership_renounced: false, owner_type: "eoa" },
    owner_percent_bps: 0,
    source_verified: true,
    ...over,
  };
}

// --- (a) verified + sellable + owner 0% + full admin caps → dampened → clear ---
{
  const r = computeTokenRiskScore(bluechip());
  // Raw static caps = 15+15+15+10+10 = 65; dampened ×0.4 = 26.
  eq(r.score, 26, "a: blue-chip dampened score");
  ok(r.score < 30, "a: blue-chip verdict is clear (score<30)");
  ok(r.dampened === true, "a: dampening applied");
  // Transparency: every capability flag still listed + a dampening reason.
  ok(r.flags.some((f) => f.includes("mint")), "a: mint capability still visible");
  ok(r.flags.some((f) => f.includes("blacklist")), "a: blacklist capability still visible");
  ok(r.flags.some((f) => f.includes("paused")), "a: pause capability still visible");
  ok(r.flags.some((f) => f.includes("upgradeable proxy")), "a: proxy capability still visible");
  ok(r.flags.some((f) => f.includes("dampened")), "a: dampening reason cited");
}

// --- (b) SAME but the sell sim reverted (honeypot) → NOT rescued → block ---
{
  const r = computeTokenRiskScore(bluechip({ sim: { sim_status: "tested", transferable: false, transfer_tax_bps: 0 } }));
  // honeypot +75 (never dampened) + full caps 65 = 140 → clamp 100.
  eq(r.score, 100, "b: honeypot score clamps to 100");
  ok(r.score >= 70, "b: honeypot verdict is block (dampening must not rescue it)");
  ok(r.dampened === false, "b: dampening NOT applied to a non-transferable token");
  ok(r.flags.some((f) => f.includes("honeypot")), "b: honeypot flag present");
}

// --- (c) SAME caps but source NOT verified → unchanged → review ---
{
  const r = computeTokenRiskScore(bluechip({ source_verified: false }));
  eq(r.score, 65, "c: unverified keeps full capability score");
  ok(r.score >= 30, "c: unverified verdict is review (score>=30)");
  ok(r.dampened === false, "c: dampening requires verified source");
}

// --- (d) verified + sellable but owner holds 50% → concentration keeps it up ---
{
  const r = computeTokenRiskScore(bluechip({ owner_percent_bps: 5000 }));
  // benign gate fails (owner>1%), caps stay 65, + eoa 50%-dump +20 = 85.
  ok(r.dampened === false, "d: whale-owner disqualifies the benign path");
  ok(r.score >= 70, "d: insider-heavy token stays block");
  ok(r.flags.some((f) => f.includes("% of total supply")), "d: owner-concentration flag present");
}

// --- (e) high transfer tax disqualifies dampening even if verified+sellable ---
{
  const r = computeTokenRiskScore(bluechip({ sim: { sim_status: "tested", transferable: true, transfer_tax_bps: 800 } }));
  // fee-on-transfer +25 (never dampened) + full caps 65 = 90.
  ok(r.dampened === false, "e: ≥5% transfer tax disqualifies the benign path");
  ok(r.score >= 70, "e: fee-on-transfer token stays block");
  ok(r.flags.some((f) => f.includes("fee on a plain transfer")), "e: fee-on-transfer flag present");
}

// --- (f) sim unavailable → can't prove sellability → no dampening ---
{
  const r = computeTokenRiskScore(bluechip({ sim: { sim_status: "unavailable", transferable: null, transfer_tax_bps: null } }));
  eq(r.score, 65, "f: unproven-sellability keeps full capability score");
  ok(r.dampened === false, "f: dampening requires a PASSED sell simulation");
}

// --- (g) null owner_percent_bps → can't prove owner is small → no dampening ---
{
  const r = computeTokenRiskScore(bluechip({ owner_percent_bps: null }));
  eq(r.score, 65, "g: unknown owner concentration keeps full score");
  ok(r.dampened === false, "g: dampening requires a known owner_percent_bps ≤1%");
}

// --- (h) non-contract address → 100, untouched by dampening ---
{
  const r = computeTokenRiskScore(bluechip({ is_contract: false }));
  eq(r.score, 100, "h: non-contract is 100");
  ok(r.dampened === false, "h: non-contract never dampened");
}

// --- (i) clean verified token with ONLY mint (AERO-shaped) stays clear ---
{
  const r = computeTokenRiskScore(bluechip({
    proxy: { is_proxy: false, proxy_standard: null },
    categories: { can_mint: true, has_blacklist: false, can_pause: false, has_fee_setter: false, has_ownership: true },
    owner: { ownership_renounced: true, owner_type: "renounced" },
  }));
  // caps = mint 15 only; benign dampen ×0.4 = 6.
  eq(r.score, 6, "i: single-capability verified token dampened to 6");
  ok(r.score < 30, "i: stays clear");
}

// --- thresholds are a named data object (no hardcoded magic, no token list) ---
{
  ok(TOKEN_RISK_THRESHOLDS.BENIGN_CAPABILITY_DAMPEN === 0.4, "thresholds: dampen factor");
  ok(TOKEN_RISK_THRESHOLDS.BENIGN_OWNER_BPS_MAX === 100, "thresholds: owner cap");
  ok(TOKEN_RISK_THRESHOLDS.HONEYPOT_REVERT === 75, "thresholds: honeypot weight");
}

// === top-holder concentration signal (GoPlus top-holder parity) ===========
const { topHolderConcentrationRisk, parseHolderConcentration } = await import("../src/index.ts");

// --- (j) a single non-owner EOA whale ADDS non-dampenable dump-risk ---------
{
  // clean renounced token (no caps, no owner) but a 55% non-owner EOA whale.
  const base = bluechip({
    proxy: { is_proxy: false, proxy_standard: null },
    categories: { can_mint: false, has_blacklist: false, can_pause: false, has_fee_setter: false, has_ownership: false },
    owner: { ownership_renounced: true, owner_type: "renounced" },
    owner_percent_bps: null,
  });
  const clean = computeTokenRiskScore({ ...base, top_holder_pct_bps: null });
  eq(clean.score, 0, "j: no whale → 0");
  const whale = computeTokenRiskScore({ ...base, top_holder_pct_bps: 5500 });
  eq(whale.score, TOKEN_RISK_THRESHOLDS.TOP_HOLDER_SCORE_HIGH, "j: 55% non-owner EOA → HIGH score");
  ok(whale.flags.some((f) => f.includes("largest non-owner wallet")), "j: whale flag visible");
}

// --- (k) whale risk is NON-dampenable even on an otherwise-benign token -----
{
  // blue-chip (verified+sellable+owner 0%) that ALSO has a 25% non-owner EOA whale.
  const r = computeTokenRiskScore({ ...bluechip(), top_holder_pct_bps: 2500 });
  // caps 65 dampened ×0.4 = 26; whale MED = 12 added on top, never dampened.
  eq(r.score, 26 + TOKEN_RISK_THRESHOLDS.TOP_HOLDER_SCORE_MED, "k: whale added post-dampen");
  ok(r.flags.some((f) => f.includes("elevated dump risk")), "k: whale dump flag present");
}

// --- (l) tiered thresholds (HIGH/MED/LOW) ----------------------------------
{
  eq(topHolderConcentrationRisk(6000).scoreAdd, TOKEN_RISK_THRESHOLDS.TOP_HOLDER_SCORE_HIGH, "l: ≥50% HIGH");
  eq(topHolderConcentrationRisk(2500).scoreAdd, TOKEN_RISK_THRESHOLDS.TOP_HOLDER_SCORE_MED, "l: ≥20% MED");
  eq(topHolderConcentrationRisk(1200).scoreAdd, TOKEN_RISK_THRESHOLDS.TOP_HOLDER_SCORE_LOW, "l: ≥10% LOW");
  eq(topHolderConcentrationRisk(500).scoreAdd, 0, "l: <10% no score");
  eq(topHolderConcentrationRisk(null).scoreAdd, 0, "l: null → degrade-open no score");
  eq(topHolderConcentrationRisk(0).scoreAdd, 0, "l: 0 → no score");
}

// --- (m) parseHolderConcentration EXCLUDES contracts, locked, and owner -----
{
  // AERO-shaped: 59% top holder is is_contract=1 (veToken) → must NOT score.
  const aero = parseHolderConcentration(
    { holder_count: 740573, holders: [
      { address: "0xebf4", percent: "0.594268", is_contract: 1, is_locked: 0 },
      { address: "0x3304", percent: "0.019783", is_contract: 0, is_locked: 0 },
    ] },
    null,
  );
  eq(aero.holder_count, 740573, "m: holder_count parsed");
  eq(aero.top_holder_pct_bps, Math.round(0.019783 * 10000), "m: contract veToken excluded; top EOA is 1.98%");
  // a locked position is excluded
  const locked = parseHolderConcentration(
    { holder_count: 10, holders: [{ address: "0xaa", percent: "0.80", is_contract: 0, is_locked: 1 }] },
    null,
  );
  eq(locked.top_holder_pct_bps, null, "m: locked holder excluded → null");
  // the owner() address is excluded (scored separately)
  const ownerDup = parseHolderConcentration(
    { holder_count: 10, holders: [{ address: "0xOWNER", percent: "0.40", is_contract: 0, is_locked: 0 }] },
    "0xowner",
  );
  eq(ownerDup.top_holder_pct_bps, null, "m: owner address excluded → no double-count");
  // degrade-open: null record → all null
  const dead = parseHolderConcentration(null, null);
  eq(dead.holder_count, null, "m: null record → holder_count null");
  eq(dead.top_holder_pct_bps, null, "m: null record → top_holder null");
  eq(dead.source, null, "m: null record → source null");
}

console.log(`token-risk-score: ${pass} checks passed`);
