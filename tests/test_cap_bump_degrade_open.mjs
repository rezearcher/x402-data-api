/**
 * Contract test: bumpDailyCap degrades OPEN under KV write-cap exhaustion.
 *
 *   node tests/test_cap_bump_degrade_open.mjs
 *
 * The six paid AI routes (/ai/ask, /ai/classify, /ai/summarize, /ai/translate,
 * /ai/extract, POST /v1/chat/completions) increment a per-day soft spend-guard
 * counter AFTER the x402 payment has settled upstream and the answer has been
 * computed. That increment used to be an `await c.env.API_KEYS.put(...)` inside
 * the response try-block, so when the account-wide Cloudflare free-tier KV write
 * cap (1,000 puts/day, shared across sibling workers) is exhausted the put threw
 * and the route returned 502 — a paying caller got NOTHING for settled USDC.
 *
 * bumpDailyCap is the fix: it runs the put detached (waitUntil) and swallows its
 * own error, so a failing/exhausted KV can never convert a paid, delivered-ready
 * response into a 502. This test proves (1) it returns synchronously without
 * throwing even when put() rejects, and (2) the detached promise it hands to
 * waitUntil resolves rather than rejecting (no unhandled rejection).
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { bumpDailyCap } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// 1. put() REJECTS (cap exhausted). bumpDailyCap must not throw, and the promise
//    it schedules via waitUntil must RESOLVE (error swallowed internally).
{
  let scheduled = null;
  const c = {
    env: { API_KEYS: { put: async () => { throw new Error("KV PUT failed: daily limit exceeded"); } } },
    executionCtx: { waitUntil: (p) => { scheduled = p; } },
  };
  let threw = false;
  try { bumpDailyCap(c, "aicap:2026-11-06", 17); } catch { threw = true; }
  ok(!threw, "bumpDailyCap does not throw synchronously when put() rejects");
  ok(scheduled instanceof Promise, "bumpDailyCap schedules a detached promise via waitUntil");
  await assert.doesNotReject(scheduled, "the detached promise resolves (put error swallowed, no unhandled rejection)");
}

// 2. Happy path: put() resolves with the incremented value, still non-blocking.
{
  let wrote = null;
  let scheduled = null;
  const c = {
    env: { API_KEYS: { put: async (k, v) => { wrote = { k, v }; } } },
    executionCtx: { waitUntil: (p) => { scheduled = p; } },
  };
  bumpDailyCap(c, "aicap:2026-11-06", 41);
  await scheduled;
  ok(wrote && wrote.k === "aicap:2026-11-06", "writes to the given key");
  ok(wrote && wrote.v === "42", "increments used+1 (41 -> '42')");
}

// 3. No ExecutionContext (e.g. a non-request context): still must not throw.
{
  const c = { env: { API_KEYS: { put: async () => { throw new Error("boom"); } } } };
  let threw = false;
  try { bumpDailyCap(c, "aicap:x", 0); } catch { threw = true; }
  ok(!threw, "bumpDailyCap tolerates a missing executionCtx without throwing");
}

// 4. API_KEYS absent entirely (optional binding): the `?.` guard means no throw.
{
  let scheduled = null;
  const c = { env: {}, executionCtx: { waitUntil: (p) => { scheduled = p; } } };
  let threw = false;
  try { bumpDailyCap(c, "aicap:x", 0); } catch { threw = true; }
  ok(!threw, "bumpDailyCap tolerates an absent API_KEYS binding");
  await assert.doesNotReject(scheduled, "detached promise resolves when API_KEYS is undefined");
}

console.log(`ok - test_cap_bump_degrade_open: ${pass} assertions passed`);
