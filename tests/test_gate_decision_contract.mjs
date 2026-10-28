/**
 * Contract tests for the pre-trade gate decision composition (src/index.ts:
 * decideSwapGate / swapImpactPct).
 *
 *   node tests/test_gate_decision_contract.mjs
 *
 * The card this pins: three signals — the token-security simulation, the measured
 * DEX buy/sell tax (both folded into `verdict`/`risk_score`/`reasons` by
 * buildTokenReport), and Uniswap v3 pool liquidity turned into price impact for the
 * caller's notional — must collapse into EXACTLY ONE {decision, reason} pair. Not a
 * flag report. So these tests assert the *precedence* between signals and that the
 * reason string is a deterministic function of the inputs (safe to log for audit).
 *
 * They test the shipped export, not a copy. Node >= 22.18 strips types; the virtual
 * cloudflare:workers module is shimmed by cfw-hooks.mjs.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { decideSwapGate, swapImpactPct } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

/** Baseline: a clean, deep, transferable token. Override per test. */
function signals(over = {}) {
  return {
    side: "buy",
    verdict: "SAFE",
    risk_score: 10,
    isHoneypot: false,
    reasons: [],
    liquidity_usd: 10_000_000,
    notional_usd: 100,
    ...over,
  };
}

const DECISIONS = new Set(["go", "hold", "block"]);

// ---------------------------------------------------------------------------
// The output shape itself — one decision, one reason, nothing to interpret.
// ---------------------------------------------------------------------------
check("output is exactly {decision, reason} with decision in go|hold|block", () => {
  const out = decideSwapGate(signals());
  assert.deepEqual(Object.keys(out).sort(), ["decision", "reason"]);
  assert.ok(DECISIONS.has(out.decision), `unexpected decision ${out.decision}`);
  assert.equal(typeof out.reason, "string");
  assert.ok(out.reason.length > 0);
});

check("every branch returns a decision in the closed set (fuzz over signals)", () => {
  const sides = ["buy", "sell"];
  const verdicts = ["SAFE", "CAUTION", "AVOID"];
  const honeypots = [true, false, null];
  const liqs = [null, 0, 1, 1_000, 250_000, 10_000_000];
  const notionals = [1, 100, 1_000, 50_000];
  let n = 0;
  for (const side of sides)
    for (const verdict of verdicts)
      for (const isHoneypot of honeypots)
        for (const liquidity_usd of liqs)
          for (const notional_usd of notionals)
            for (const risk_score of [0, 49, 50, 90]) {
              const out = decideSwapGate(signals({ side, verdict, isHoneypot, liquidity_usd, notional_usd, risk_score }));
              assert.ok(DECISIONS.has(out.decision), `bad decision for ${JSON.stringify({ side, verdict, isHoneypot, liquidity_usd, notional_usd, risk_score })}`);
              assert.equal(typeof out.reason, "string");
              assert.ok(out.reason.length > 0);
              n++;
            }
  assert.equal(n, 2 * 3 * 3 * 6 * 4 * 4);
});

// ---------------------------------------------------------------------------
// Signal 1: token-security simulation (honeypot) — the hardest fail-closed path.
// ---------------------------------------------------------------------------
check("proven honeypot blocks a BUY", () => {
  const out = decideSwapGate(signals({ verdict: "AVOID", risk_score: 90, isHoneypot: true, reasons: ["simulated transfer reverted"] }));
  assert.equal(out.decision, "block");
  assert.equal(out.reason, "simulated transfer reverted");
});

check("proven honeypot blocks a SELL (the exit the seller cannot make)", () => {
  const out = decideSwapGate(signals({ side: "sell", verdict: "AVOID", risk_score: 90, isHoneypot: true, reasons: ["simulated transfer reverted"] }));
  assert.equal(out.decision, "block");
});

check("AVOID without a proven honeypot HOLDs a SELL — never fabricates a block", () => {
  const out = decideSwapGate(
    signals({ side: "sell", verdict: "AVOID", risk_score: 85, isHoneypot: null, reasons: ["measured DEX sell tax ~25.0%"] }),
  );
  assert.equal(out.decision, "hold");
  assert.equal(out.reason, "measured DEX sell tax ~25.0%");
});

check("AVOID without a proven honeypot still BLOCKs a BUY", () => {
  const out = decideSwapGate(signals({ verdict: "AVOID", risk_score: 85, isHoneypot: null, reasons: ["owner can mint new supply"] }));
  assert.equal(out.decision, "block");
});

check("AVOID reason falls back deterministically when reasons[] is empty", () => {
  const out = decideSwapGate(signals({ verdict: "AVOID", risk_score: 88, isHoneypot: true, reasons: [] }));
  assert.equal(out.decision, "block");
  assert.equal(out.reason, "token flagged AVOID");
});

// ---------------------------------------------------------------------------
// Signal 3: liquidity → price impact. Size is the second precedence tier.
// ---------------------------------------------------------------------------
check("impact > 10% of pool BLOCKs even a SAFE token", () => {
  const out = decideSwapGate(signals({ liquidity_usd: 5_000, notional_usd: 1_000 })); // 20%
  assert.equal(out.decision, "block");
  assert.match(out.reason, /^trade is 20\.0% of pool liquidity; severe price impact$/);
});

check("impact boundary: exactly 10% is not 'severe' (>10 is exclusive) — falls to split", () => {
  const out = decideSwapGate(signals({ liquidity_usd: 10_000, notional_usd: 1_000 })); // exactly 10%
  assert.equal(out.decision, "hold");
  assert.match(out.reason, /split the order$/);
});

check("impact 2-10% HOLDs and says to split", () => {
  const out = decideSwapGate(signals({ liquidity_usd: 100_000, notional_usd: 5_000 })); // 5%
  assert.equal(out.decision, "hold");
  assert.match(out.reason, /^trade is 5\.0% of pool liquidity; split the order$/);
});

check("impact <= 2% passes as GO with the rounded pct in the reason", () => {
  const out = decideSwapGate(signals({ liquidity_usd: 250_000, notional_usd: 1_000 })); // 0.4%
  assert.equal(out.decision, "go");
  assert.match(out.reason, /^token passes safety checks; trade is 0\.40% of pool liquidity$/);
});

check("AVOID outranks size: an oversized trade on a condemned token keeps the AVOID reason", () => {
  const out = decideSwapGate(
    signals({ verdict: "AVOID", risk_score: 90, isHoneypot: true, reasons: ["simulated transfer reverted"], liquidity_usd: 1_000, notional_usd: 10_000 }),
  );
  assert.equal(out.decision, "block");
  assert.equal(out.reason, "simulated transfer reverted");
});

// ---------------------------------------------------------------------------
// Signal 3 (cont.): missing liquidity is a HOLD, never a GO — the fail-closed core.
// ---------------------------------------------------------------------------
check("null liquidity HOLDs a BUY (cannot size, cannot confirm exit)", () => {
  const out = decideSwapGate(signals({ liquidity_usd: null }));
  assert.equal(out.decision, "hold");
  assert.match(out.reason, /^no verifiable Uniswap v3 WETH-pool liquidity/);
  assert.match(out.reason, /not safe to auto-buy$/);
});

check("null liquidity HOLDs a SELL with the venue question, not a size excuse", () => {
  const out = decideSwapGate(signals({ side: "sell", liquidity_usd: null }));
  assert.equal(out.decision, "hold");
  assert.match(out.reason, /cannot confirm an on-chain exit venue/);
});

check("zero liquidity HOLDs (degenerate pool must not fall through to GO)", () => {
  const out = decideSwapGate(signals({ liquidity_usd: 0 }));
  assert.equal(out.decision, "hold");
  assert.match(out.reason, /no verifiable/);
});

check("missing liquidity HOLDs even a CAUTION sell (never GO without a venue)", () => {
  const out = decideSwapGate(signals({ side: "sell", verdict: "CAUTION", risk_score: 20, liquidity_usd: null }));
  assert.equal(out.decision, "hold");
});

// ---------------------------------------------------------------------------
// Signal 2: measured DEX tax reaches the gate only through the fused verdict —
// so the tax-to-decision mapping must hold end to end.
// ---------------------------------------------------------------------------
check("high measured sell tax (-> AVOID) blocks a buy", () => {
  // dexTaxRisk(0, 1500) -> scoreFloor 70 -> score>=70 -> verdict AVOID
  const out = decideSwapGate(
    signals({ verdict: "AVOID", risk_score: 70, isHoneypot: false, reasons: ["measured DEX sell tax ~15.0% — a real wallet keeps far less than it sells"] }),
  );
  assert.equal(out.decision, "block");
  assert.match(out.reason, /measured DEX sell tax/);
});

check("moderate fee-on-transfer (-> CAUTION, score<50) does not block a buy", () => {
  const out = decideSwapGate(signals({ verdict: "CAUTION", risk_score: 38, reasons: ["measured DEX fee-on-transfer (buy ~4.0%); factor it into round-trip cost"] }));
  assert.equal(out.decision, "go");
  assert.match(out.reason, /fee-on-transfer/);
});

check("CAUTION at risk>=50 HOLDs a buy, but a sell is allowed through", () => {
  const buy = decideSwapGate(signals({ verdict: "CAUTION", risk_score: 55, reasons: ["transfers can be paused"] }));
  assert.equal(buy.decision, "hold");
  const sell = decideSwapGate(signals({ side: "sell", verdict: "CAUTION", risk_score: 90, reasons: ["transfers can be paused"] }));
  assert.equal(sell.decision, "go");
});

check("CAUTION with no reasons still yields a deterministic audit string", () => {
  const out = decideSwapGate(signals({ verdict: "CAUTION", risk_score: 60, reasons: [] }));
  assert.equal(out.decision, "hold");
  assert.equal(out.reason, "caution flags present");
});

// ---------------------------------------------------------------------------
// Audit guardrail: identical signals -> identical output, always.
// ---------------------------------------------------------------------------
check("decision + reason are a pure function of the signals (100 repeats)", () => {
  const s = signals({ verdict: "CAUTION", risk_score: 55, reasons: ["transfers can be paused"], liquidity_usd: 250_000, notional_usd: 1_000 });
  const first = decideSwapGate(s);
  for (let i = 0; i < 100; i++) assert.deepEqual(decideSwapGate({ ...s }), first);
});

check("a changed signal changes the reason (the string is not hardcoded)", () => {
  const a = decideSwapGate(signals({ liquidity_usd: 250_000, notional_usd: 1_000 })); // 0.4% -> go
  const b = decideSwapGate(signals({ liquidity_usd: 40_000, notional_usd: 1_000 })); // 2.5% -> hold
  assert.notEqual(a.reason, b.reason);
  assert.equal(a.decision, "go");
  assert.equal(b.decision, "hold");
});

// ---------------------------------------------------------------------------
// Pure math helper: impact is null (not 0, not Infinity) when there is no pool.
// ---------------------------------------------------------------------------
check("swapImpactPct returns null for null liquidity", () => {
  assert.equal(swapImpactPct(null, 1_000), null);
});

check("swapImpactPct returns null for a zero pool (no division blowup)", () => {
  assert.equal(swapImpactPct(0, 1_000), null);
});

check("swapImpactPct computes % of pool", () => {
  assert.equal(swapImpactPct(100_000, 1_000), 1);
  assert.equal(swapImpactPct(1_000, 10_000), 1_000);
});

console.log(`\n${pass} checks passed`);
