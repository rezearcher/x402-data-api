/**
 * Contract tests for the PAID /gate/swap `sized_verdict` top-line string
 * (src/index.ts: sizedVerdictLine + sizedExecution).
 *
 *   node tests/test_sized_verdict.mjs
 *
 * The sized_verdict is the moat made legible to raw LLM/agent callers — the
 * segment that produced 100% of historical external revenue (365 raw x402 txs).
 * These assertions pin the top-line contract so a refactor can't silently drop
 * the sizing numbers (max-safe / round-trip breakeven / exit recovery) back into
 * the nested JSON that LLM callers under-read. Node >= 22.18 strips types; the
 * virtual cloudflare:workers module is shimmed by cfw-hooks.mjs (same as the
 * verify suite). Both functions are real exports from the Worker module — this
 * tests the shipped code, not a copy.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { sizedExecution, sizedVerdictLine } = await import("../src/index.ts");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`ok - ${name}`);
}

const TOKEN = "0x4200000000000000000000000000000000000006";

// 1. GO on a deep pool → the line must carry ALL four sizing facts a trader sizes on.
check("GO carries decision + all sizing facts", () => {
  const notional = 500;
  const sizing = sizedExecution(2_000_000, notional); // $2M pool
  const out = {
    decision: "go",
    reason: "token passes safety checks; trade is 0.03% of pool liquidity",
    side: "buy",
    notional_usd: notional,
    token: TOKEN,
  };
  const line = sizedVerdictLine(out, sizing);
  assert.ok(line.startsWith("GO buy $500 of 0x4200"), `head wrong: ${line}`);
  assert.ok(/passes safety checks/.test(line), "reason missing");
  assert.ok(/% of pool depth/.test(line), "this-trade impact missing");
  assert.ok(/trade up to ~\$[\d,]+\/order/.test(line), "max-safe missing");
  assert.ok(/round-trip breakeven \+[\d.]+%/.test(line), "breakeven missing");
  assert.ok(/exit now recovers ~\$[\d,]+/.test(line), "exit recovery missing");
  // max_safe must equal 2% of pool (ground-truth from sizedExecution).
  assert.ok(line.includes("~$40,000/order"), `max-safe value wrong: ${line}`);
  assert.ok(line.endsWith("."), "must end with a period");
});

// 2. No verifiable pool → sizing unavailable, said plainly, no fabricated numbers.
check("null pool collapses to verdict + unavailable notice", () => {
  const sizing = sizedExecution(null, 100);
  const out = {
    decision: "hold",
    reason: "no verifiable Uniswap v3 WETH-pool liquidity — not safe to auto-buy",
    side: "buy",
    notional_usd: 100,
    token: TOKEN,
  };
  const line = sizedVerdictLine(out, sizing);
  assert.ok(line.startsWith("HOLD buy $100 of 0x4200"), `head wrong: ${line}`);
  assert.ok(/Trade sizing unavailable/.test(line), "must flag unavailable");
  assert.ok(!/breakeven/.test(line), "must not fabricate breakeven");
  assert.ok(!/recovers/.test(line), "must not fabricate exit recovery");
});

// 3. BLOCK verdict is surfaced verbatim in the action head.
check("BLOCK verdict surfaces in head", () => {
  const sizing = sizedExecution(5_000, 2_000); // thin pool, big trade
  const out = {
    decision: "block",
    reason: "trade is 40.0% of pool liquidity; severe price impact",
    side: "buy",
    notional_usd: 2_000,
    token: TOKEN,
  };
  const line = sizedVerdictLine(out, sizing);
  assert.ok(line.startsWith("BLOCK buy $2,000 of 0x4200"), `head wrong: ${line}`);
  assert.ok(/severe price impact/.test(line), "reason missing");
});

// 4. Degrade-open: a malformed/empty out never throws, always returns a string.
check("degrade-open on missing fields", () => {
  const line = sizedVerdictLine(
    { decision: "", reason: "", side: "buy", notional_usd: 100, token: TOKEN },
    sizedExecution(null, 100),
  );
  assert.strictEqual(typeof line, "string");
  assert.ok(line.startsWith("HOLD "), "empty decision defaults to HOLD");
});

// 5. No double-period when reason already ends in a period.
check("no double period when reason ends in period", () => {
  const line = sizedVerdictLine(
    { decision: "go", reason: "token passes safety checks.", side: "buy", notional_usd: 100, token: TOKEN },
    sizedExecution(1_000_000, 100),
  );
  assert.ok(!line.includes("checks.."), `double period: ${line}`);
});

console.log(`\n# sized_verdict contract: ${pass}/5 passed`);
