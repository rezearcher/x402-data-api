/**
 * Paid-usage counter tests for x402-data-api (mirrors x402-cve-triage's
 * tests/test_usage.js, extended with the prepaid api-key rail).
 *
 * Run with plain node — no build step, no dependencies:
 *   node tests/test_usage.js
 *
 * Node >= 22.18 loads the .ts sources directly (type stripping on by default).
 * The virtual `cloudflare:workers` module (imported by src/index.ts) is shimmed
 * via a register() hook to a local no-op DurableObject base class. globalThis
 * fetch is stubbed and the counter binding is a fake DO-backed store, so these
 * tests never touch the network.
 *
 * Covers:
 *   - x402-paid calls increment usage:paid:<route> + usage:rail:x402-paid
 *     (+ first/last ts bookends)
 *   - GUARDRAIL: rapidapi-bypass AND api-key (both already-paid, non-chain
 *     rails) increment their rail counter ONLY — never usage:paid:<route>,
 *     never ts
 *   - the paid surface (4 premium + freemium + POST /mcp) is tracked
 *   - getMetrics aggregates total / by-route / by-rail / first+last ts
 *   - /metrics endpoint is gate-bypassed, aggregate-only (no PAY_TO/keys),
 *     and reads DO-backed counters through the USAGE_COUNTER binding
 *   - end-to-end RapidAPI bypass: exact secret only, rail counter only, bogus
 *     secret 402s and writes no counters anywhere
 *   - end-to-end prepaid api_key bypass via X-API-Key header (audit-q3 F5):
 *     valid key 200 + api-key rail only; query-string form removed (402)
 *   - unpaid POST /mcp tools/call is 402-gated, zero counters written
 *   - no-counter degradation: counters no-op, metrics return zeros
 *   - concurrency losslessness (F-05): 50 concurrent increments must end at
 *     exactly 50 — the DO serializes apply() batches
 */
import assert from "node:assert";
import { register } from "node:module";

// Shim the virtual `cloudflare:workers` module BEFORE importing src/index.ts
// (the import itself is dynamic, below, so the hook is live by then).
register(new URL("./cfw-hooks.mjs", import.meta.url));

const { trackPaidRequest, getMetrics } = await import("../src/usage.ts");
const { default: app } = await import("../src/index.ts");

// ---------------------------------------------------------------------------
// Fake KV store (Cloudflare KVNamespace-shaped) — cache / API_KEYS bindings.
// ---------------------------------------------------------------------------
function makeFakeKV() {
  const store = new Map();
  const calls = { get: 0, put: 0 };
  return {
    calls,
    store,
    async get(key, _type) {
      calls.get += 1;
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      calls.put += 1;
      store.set(key, value);
    },
  };
}

// ---------------------------------------------------------------------------
// Fake atomic counter (UsageCounterLike-shaped) — models the Durable Object.
// The forced yield at the top of apply() makes concurrent callers interleave
// there; each batch then applies with no further await points, so a batch is
// atomic — exactly how the real DO serializes one fetch at a time. A naive
// KV-style get/put read-modify-write would lose increments under the same
// interleaving (the F-05 bug).
// ---------------------------------------------------------------------------
function makeFakeCounter() {
  const store = new Map();
  return {
    store,
    async apply(ops) {
      await new Promise((r) => setTimeout(r, 0));
      for (const op of ops) {
        if (op.kind === "increment") {
          const cur = typeof store.get(op.key) === "number" ? store.get(op.key) : 0;
          store.set(op.key, cur + (op.by ?? 1));
        } else if (op.kind === "set-if-absent") {
          if (!store.has(op.key)) store.set(op.key, op.value);
        } else if (op.kind === "set") {
          store.set(op.key, op.value);
        }
      }
    },
    async snapshot() {
      return Object.fromEntries(store);
    },
  };
}

// ---------------------------------------------------------------------------
// Fake DurableObjectNamespace — lets the end-to-end tests exercise the real
// makeUsageCounter() adapter (idFromName -> get -> stub.fetch) without a
// workerd runtime. Same op semantics as the real UsageCounter DO.
// ---------------------------------------------------------------------------
function makeFakeDONamespace(store) {
  return {
    idFromName: (name) => `id:${name}`,
    get: () => ({
      async fetch(_url, init = {}) {
        if ((init.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(Object.fromEntries(store)), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const { ops } = JSON.parse(init.body);
        for (const op of ops) {
          if (op.kind === "increment") {
            const cur = typeof store.get(op.key) === "number" ? store.get(op.key) : 0;
            store.set(op.key, cur + (op.by ?? 1));
          } else if (op.kind === "set-if-absent") {
            if (!store.has(op.key)) store.set(op.key, op.value);
          } else if (op.kind === "set") {
            store.set(op.key, op.value);
          }
        }
        return new Response(JSON.stringify({ ok: true, applied: ops.length }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Fake CreditLedger DO namespace for the api_key bypass test: get(id) must
// return a stub exposing deductCredit(seed) -> { deducted, remaining }
// (discriminated contract, audit F3).
// ---------------------------------------------------------------------------
function makeFakeLedgerNamespace(initialRemaining) {
  const calls = { deductCredit: 0 };
  return {
    calls,
    idFromName: (name) => `ledger:${name}`,
    get: () => ({
      async deductCredit(_seed) {
        calls.deductCredit += 1;
        return { deducted: initialRemaining > 0, remaining: initialRemaining };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Fetch stub — serves facilitator /supported + Base mainnet JSON-RPC (the
// /chain/block-number handler's upstream). Any unexpected URL fails loudly.
// ---------------------------------------------------------------------------
function installFetchStub() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/supported")) {
      return new Response(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
          extensions: [],
          signers: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("mainnet.base.org") || u.includes("base-rpc.publicnode.com")) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", result: "0x1", id: 1 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`test fetch stub hit unexpected URL: ${u}`);
  };
}

const PAY_TO = "0x95E6a9761522e9533D74bBeBe47E1C5AD8E3C685";
const BASE_ENV = {
  PAY_TO,
  FACILITATOR_URL: "http://facilitator.test",
  NETWORK: "eip155:8453",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// 1. x402-paid call: route counter, x402 rail counter, and ts bookends.
async function testX402PaidTracksRouteRailAndTs() {
  const counter = makeFakeCounter();

  await trackPaidRequest("GET /enrich/domain", "x402-paid", counter);
  assert.strictEqual(
    counter.store.get("usage:paid:GET /enrich/domain"),
    1,
    "usage:paid:<route> must increment for x402-paid",
  );
  assert.strictEqual(counter.store.get("usage:rail:x402-paid"), 1);
  const firstTs = counter.store.get("usage:ts:first");
  const lastTs = counter.store.get("usage:ts:last");
  assert.ok(firstTs && lastTs, "x402-paid must set first/last ts bookends");
  assert.strictEqual(firstTs, lastTs, "first call: first and last ts equal");

  // Second call: route counter accumulates, first ts frozen, last ts moves.
  await trackPaidRequest("GET /enrich/domain", "x402-paid", counter);
  assert.strictEqual(counter.store.get("usage:paid:GET /enrich/domain"), 2);
  assert.strictEqual(counter.store.get("usage:rail:x402-paid"), 2);
  assert.strictEqual(
    counter.store.get("usage:ts:first"),
    firstTs,
    "first ts must never be overwritten",
  );
  assert.ok(
    parseInt(counter.store.get("usage:ts:last"), 10) >= parseInt(lastTs, 10),
    "last ts must be updated",
  );

  console.log("  ok 1: x402-paid call increments route + rail counters and ts bookends");
}

// 2. GUARDRAIL: rapidapi-bypass AND api-key (already-paid, non-chain rails)
//    must NEVER increment paid counters or ts bookends.
async function testNonChainRailsNeverTouchPaidCounters() {
  const counter = makeFakeCounter();

  await trackPaidRequest("GET /enrich/domain", "rapidapi-bypass", counter);
  await trackPaidRequest("GET /enrich/domain", "api-key", counter);
  assert.strictEqual(counter.store.get("usage:rail:rapidapi-bypass"), 1);
  assert.strictEqual(counter.store.get("usage:rail:api-key"), 1);
  assert.strictEqual(
    counter.store.get("usage:paid:GET /enrich/domain"),
    undefined,
    "non-chain rails must NOT increment usage:paid:<route> (guardrail)",
  );
  assert.strictEqual(
    counter.store.get("usage:ts:first"),
    undefined,
    "non-chain rails must NOT set first ts (guardrail)",
  );
  assert.strictEqual(
    counter.store.get("usage:ts:last"),
    undefined,
    "non-chain rails must NOT set last ts (guardrail)",
  );

  // A real paid call afterwards still works and is unaffected.
  await trackPaidRequest("GET /enrich/domain", "x402-paid", counter);
  assert.strictEqual(counter.store.get("usage:paid:GET /enrich/domain"), 1);
  assert.strictEqual(counter.store.get("usage:rail:rapidapi-bypass"), 1);
  assert.strictEqual(counter.store.get("usage:rail:api-key"), 1);
  assert.strictEqual(counter.store.get("usage:rail:x402-paid"), 1);

  console.log("  ok 2: rapidapi-bypass + api-key increment ONLY their rail counters (guardrail)");
}

// 3. The paid surface is tracked: 4 premium routes + freemium + POST /mcp.
async function testPaidSurfaceTracked() {
  const counter = makeFakeCounter();

  await trackPaidRequest("GET /enrich/domain", "x402-paid", counter);
  await trackPaidRequest("GET /enrich/tech-risk", "x402-paid", counter);
  await trackPaidRequest("GET /scan/mcp", "x402-paid", counter);
  await trackPaidRequest("GET /chain/token-security", "x402-paid", counter);
  await trackPaidRequest("GET /chain/block-number", "x402-paid", counter);
  await trackPaidRequest("POST /mcp", "x402-paid", counter);
  await trackPaidRequest("POST /mcp", "rapidapi-bypass", counter);

  assert.strictEqual(counter.store.get("usage:paid:GET /enrich/domain"), 1);
  assert.strictEqual(counter.store.get("usage:paid:GET /enrich/tech-risk"), 1);
  assert.strictEqual(counter.store.get("usage:paid:GET /scan/mcp"), 1);
  assert.strictEqual(counter.store.get("usage:paid:GET /chain/token-security"), 1);
  assert.strictEqual(counter.store.get("usage:paid:GET /chain/block-number"), 1);
  assert.strictEqual(counter.store.get("usage:paid:POST /mcp"), 1);
  assert.strictEqual(counter.store.get("usage:rail:x402-paid"), 6);
  assert.strictEqual(counter.store.get("usage:rail:rapidapi-bypass"), 1);

  console.log("  ok 3: paid surface tracked — 4 premium routes + freemium + POST /mcp");
}

// 4. getMetrics aggregates total / by-route / by-rail / ts.
async function testMetricsAggregation() {
  const counter = makeFakeCounter();

  await trackPaidRequest("GET /enrich/domain", "x402-paid", counter);
  await trackPaidRequest("GET /enrich/domain", "x402-paid", counter);
  await trackPaidRequest("POST /mcp", "x402-paid", counter);
  await trackPaidRequest("POST /mcp", "rapidapi-bypass", counter);
  await trackPaidRequest("POST /mcp", "api-key", counter);

  const m = await getMetrics(counter);
  assert.strictEqual(m.total_paid_calls, 3, "total = sum of x402-paid route counters");
  assert.strictEqual(m.by_route["GET /enrich/domain"], 2);
  assert.strictEqual(m.by_route["POST /mcp"], 1);
  assert.strictEqual(m.by_route["GET /scan/mcp"], 0);
  assert.deepStrictEqual(m.by_rail, {
    "x402-paid": 3,
    "rapidapi-bypass": 1,
    "api-key": 1,
  });
  assert.ok(m.first_call_ts !== null && m.last_call_ts !== null);
  assert.ok(m.last_call_ts >= m.first_call_ts);

  console.log("  ok 4: getMetrics aggregates total / by-route / by-rail / ts");
}

// 5. No-counter degradation: trackPaidRequest no-ops, getMetrics zeros.
async function testNoCounterDegrades() {
  await trackPaidRequest("GET /enrich/domain", "x402-paid", undefined); // must not throw
  const m = await getMetrics(undefined);
  assert.strictEqual(m.total_paid_calls, 0);
  assert.strictEqual(m.by_route["GET /enrich/domain"], 0);
  assert.strictEqual(m.by_rail["x402-paid"], 0);
  assert.strictEqual(m.by_rail["rapidapi-bypass"], 0);
  assert.strictEqual(m.by_rail["api-key"], 0);
  assert.strictEqual(m.first_call_ts, null);
  assert.strictEqual(m.last_call_ts, null);

  console.log("  ok 5: no counter binding — counters no-op, metrics return zeros");
}

// 6. /metrics endpoint is gate-bypassed and aggregate-only (no PAY_TO/keys).
async function testMetricsEndpointGateBypassed() {
  const ENV = { ...BASE_ENV, CACHE: makeFakeKV() };

  // No rapidapi secret, no api key, no x402 payment, no well-known path —
  // must still be 200.
  const res = await app.request("/metrics", {}, ENV);
  assert.strictEqual(res.status, 200, "/metrics must be gate-bypassed");
  const body = await res.json();
  assert.strictEqual(typeof body.total_paid_calls, "number");
  assert.ok(body.by_route && typeof body.by_route === "object");
  assert.ok(body.by_rail && typeof body.by_rail === "object");

  const text = JSON.stringify(body);
  assert.ok(
    !text.includes("PAY_TO") && !text.includes("0x95E6a976"),
    "/metrics must not leak PAY_TO",
  );
  // Rail labels (rapidapi-bypass / api-key) are aggregate counts and are
  // expected; what must never appear are secret/key VALUES.
  assert.ok(
    !text.includes("secret") && !text.includes("rapidapi-key") && !text.includes("api_key="),
    "no keys/secrets in /metrics",
  );

  console.log("  ok 6: /metrics gate-bypassed, aggregate-only, no PAY_TO/keys");
}

// 7. End-to-end: exact-match RapidAPI proxy secret on a paid route goes
//    through the real gate bypass + handler; only the rapidapi-bypass rail
//    counter moves (through the real makeUsageCounter -> DO-stub path). A
//    bogus secret must NOT bypass the gate (402).
async function testRapidapiBypassEndToEnd() {
  installFetchStub();
  const doStore = new Map();
  const ENV = {
    ...BASE_ENV,
    CACHE: makeFakeKV(),
    RAPIDAPI_PROXY_SECRET: "rapidapi-proxy-secret-test-0123456789abcdef",
    USAGE_COUNTER: makeFakeDONamespace(doStore),
  };

  const res = await app.request(
    "/chain/block-number",
    { headers: { "X-RapidAPI-Proxy-Secret": ENV.RAPIDAPI_PROXY_SECRET } },
    ENV,
  );
  assert.strictEqual(res.status, 200, "exact-match proxy secret must bypass and succeed");
  const body = await res.json();
  assert.strictEqual(body.block_number, 1, "handler must return the stubbed block number");

  // Fire-and-forget write is scheduled via waitUntil; give it a microtask beat.
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(
    doStore.get("usage:rail:rapidapi-bypass"),
    1,
    "end-to-end bypass must count on the rapidapi-bypass rail (DO counter)",
  );
  assert.strictEqual(
    doStore.get("usage:paid:GET /chain/block-number"),
    undefined,
    "end-to-end bypass must NOT increment the paid route counter (guardrail)",
  );
  assert.strictEqual(doStore.get("usage:ts:first"), undefined, "bypass must not set ts");

  // Negative: a bogus secret must be challenged (402), not bypassed.
  const bogus = await app.request(
    "/chain/block-number",
    { headers: { "X-RapidAPI-Proxy-Secret": "a".repeat(48) } },
    ENV,
  );
  assert.strictEqual(bogus.status, 402, "bogus secret must NOT bypass the gate");
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(
    doStore.get("usage:rail:rapidapi-bypass"),
    1,
    "a 402'd request must not move the rail counter",
  );

  console.log("  ok 7: end-to-end RapidAPI bypass — exact secret only, rail counter only, bogus 402");
}

// 8. End-to-end: prepaid api_key bypass via X-API-Key header (audit-q3 F5) —
//    valid key 200 + api-key rail only; the ?api_key= query form is DEAD.
async function testApiKeyBypassEndToEnd() {
  installFetchStub();
  const doStore = new Map();
  const apiKeys = makeFakeKV();
  apiKeys.store.set(
    "key-test-1234",
    JSON.stringify({ do_id: "ledger:key-test-1234", credits_remaining: 100, expires_at: 4102444800000 }),
  );
  const ENV = {
    ...BASE_ENV,
    CACHE: makeFakeKV(),
    API_KEYS: apiKeys,
    CREDIT_LEDGER: makeFakeLedgerNamespace(99),
    USAGE_COUNTER: makeFakeDONamespace(doStore),
  };

  // Positive: the key travels as an X-API-Key header — never in the URL.
  const res = await app.request(
    "/chain/block-number",
    { headers: { "X-API-Key": "key-test-1234" } },
    ENV,
  );
  assert.strictEqual(res.status, 200, "valid X-API-Key header must bypass and succeed");
  const body = await res.json();
  assert.strictEqual(body.block_number, 1);

  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(
    ENV.CREDIT_LEDGER.calls.deductCredit,
    1,
    "valid header key must deduct exactly one credit (F3 discriminated contract)",
  );
  assert.strictEqual(
    doStore.get("usage:rail:api-key"),
    1,
    "end-to-end api_key bypass must count on the api-key rail (DO counter)",
  );
  assert.strictEqual(
    doStore.get("usage:paid:GET /chain/block-number"),
    undefined,
    "end-to-end api_key bypass must NOT increment the paid route counter (guardrail)",
  );

  // F5 guardrail: the ?api_key= query-string form is fully removed. A request
  // carrying the key ONLY in the URL (no header) falls through to the x402 gate
  // and must be challenged, even though the key itself is valid.
  const queryForm = await app.request("/chain/block-number?api_key=key-test-1234", {}, ENV);
  assert.strictEqual(queryForm.status, 402, "query-string api_key must NOT bypass (F5 removed it)");
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(
    ENV.CREDIT_LEDGER.calls.deductCredit,
    1,
    "query-string key must not deduct a credit",
  );
  assert.strictEqual(
    doStore.get("usage:rail:api-key"),
    1,
    "query-string key must not move the api-key rail counter",
  );

  // Negative: unknown key in the header falls through to the x402 gate => 402.
  const bogus = await app.request(
    "/chain/block-number",
    { headers: { "X-API-Key": "key-unknown" } },
    ENV,
  );
  assert.strictEqual(bogus.status, 402, "unknown X-API-Key must NOT bypass the gate");
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(
    ENV.CREDIT_LEDGER.calls.deductCredit,
    1,
    "a 402'd request must not deduct a credit",
  );
  assert.strictEqual(
    doStore.get("usage:rail:api-key"),
    1,
    "a 402'd request must not move the api-key rail counter",
  );

  console.log("  ok 8: end-to-end api_key bypass — X-API-Key header 200 + api-key rail only, query-string form dead (F5), unknown key 402");
}

// 9. End-to-end: unpaid POST /mcp tools/call is 402-gated and never reaches
//    tracking — with the counter binding present, a 402'd request writes
//    nothing.
async function testUnpaidMcpGatedNoTracking() {
  installFetchStub();
  const doStore = new Map();
  const ENV = {
    ...BASE_ENV,
    CACHE: makeFakeKV(),
    USAGE_COUNTER: makeFakeDONamespace(doStore),
  };
  const mcpBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "enrich_domain", arguments: { domain: "stripe.com" } },
  });

  const res = await app.request(
    "/mcp",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: mcpBody,
    },
    ENV,
  );
  assert.strictEqual(res.status, 402, "unpaid POST /mcp must 402");
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(doStore.size, 0, "no counters written for a 402'd request");

  console.log("  ok 9: unpaid POST /mcp → 402, no usage counters written");
}

// 10. /metrics reflects DO-backed counters through the real USAGE_COUNTER
//     binding adapter (makeUsageCounter -> idFromName -> stub.fetch -> GET).
async function testMetricsEndpointReadsDoCounters() {
  const doStore = new Map();
  const ENV = {
    ...BASE_ENV,
    CACHE: makeFakeKV(),
    USAGE_COUNTER: makeFakeDONamespace(doStore),
  };

  // Seed the DO store the way the real DO would after 3 paid + 2 bypass calls.
  doStore.set("usage:paid:GET /enrich/domain", 3);
  doStore.set("usage:paid:POST /mcp", 1);
  doStore.set("usage:rail:x402-paid", 4);
  doStore.set("usage:rail:rapidapi-bypass", 2);
  doStore.set("usage:rail:api-key", 1);
  doStore.set("usage:ts:first", "1700000000");
  doStore.set("usage:ts:last", "1700000100");

  const res = await app.request("/metrics", {}, ENV);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.total_paid_calls, 4, "/metrics must read DO counters via the binding");
  assert.strictEqual(body.by_route["GET /enrich/domain"], 3);
  assert.strictEqual(body.by_route["POST /mcp"], 1);
  assert.strictEqual(body.by_route["GET /chain/block-number"], 0);
  assert.strictEqual(body.by_rail["x402-paid"], 4);
  assert.strictEqual(body.by_rail["rapidapi-bypass"], 2);
  assert.strictEqual(body.by_rail["api-key"], 1);
  assert.strictEqual(body.first_call_ts, 1700000000);
  assert.strictEqual(body.last_call_ts, 1700000100);

  console.log("  ok 10: /metrics reads DO-backed counters via the USAGE_COUNTER binding");
}

// 11. Concurrency losslessness (F-05): 50 concurrent increments must end at
//     exactly 50. The DO serializes apply() batches; a KV read-modify-write
//     loses updates under the same interleaving.
async function testConcurrentIncrementsLossless() {
  const counter = makeFakeCounter();

  // Phase A — 50 concurrent unpaid (rapidapi-bypass) increments: the bypass
  // rail lands at exactly 50, and the guardrail holds under concurrency too.
  await Promise.all(
    Array.from({ length: 50 }, () =>
      trackPaidRequest("POST /mcp", "rapidapi-bypass", counter),
    ),
  );
  assert.strictEqual(counter.store.get("usage:rail:rapidapi-bypass"), 50);
  assert.strictEqual(
    counter.store.get("usage:paid:POST /mcp"),
    undefined,
    "guardrail holds under concurrency — bypass must not touch paid counters",
  );
  assert.strictEqual(
    counter.store.get("usage:ts:first"),
    undefined,
    "bypass must not set ts even under concurrency",
  );

  // Phase B — 50 concurrent paid increments on the same route: must end at
  // exactly 50 (no lost updates), ts bookends set.
  await Promise.all(
    Array.from({ length: 50 }, () =>
      trackPaidRequest("GET /enrich/domain", "x402-paid", counter),
    ),
  );
  assert.strictEqual(
    counter.store.get("usage:paid:GET /enrich/domain"),
    50,
    "50 concurrent paid increments must end at exactly 50 (no lost updates)",
  );
  assert.strictEqual(counter.store.get("usage:rail:x402-paid"), 50);
  assert.strictEqual(
    counter.store.get("usage:rail:rapidapi-bypass"),
    50,
    "bypass rail unaffected by paid concurrency",
  );
  assert.strictEqual(typeof counter.store.get("usage:ts:first"), "string");
  assert.strictEqual(typeof counter.store.get("usage:ts:last"), "string");

  // Phase C — interleave 25 paid + 25 api-key on POST /mcp concurrently.
  await Promise.all([
    ...Array.from({ length: 25 }, () =>
      trackPaidRequest("POST /mcp", "x402-paid", counter),
    ),
    ...Array.from({ length: 25 }, () =>
      trackPaidRequest("POST /mcp", "api-key", counter),
    ),
  ]);
  assert.strictEqual(counter.store.get("usage:paid:POST /mcp"), 25);
  assert.strictEqual(counter.store.get("usage:rail:api-key"), 25);
  assert.strictEqual(counter.store.get("usage:rail:x402-paid"), 75);
  assert.strictEqual(
    counter.store.get("usage:paid:GET /enrich/domain"),
    50,
    "route counter untouched by the POST interleave",
  );

  // getMetrics agrees with the lossless totals.
  const m = await getMetrics(counter);
  assert.strictEqual(m.total_paid_calls, 75);
  assert.strictEqual(m.by_route["GET /enrich/domain"], 50);
  assert.strictEqual(m.by_route["POST /mcp"], 25);
  assert.strictEqual(m.by_rail["x402-paid"], 75);
  assert.strictEqual(m.by_rail["api-key"], 25);
  assert.strictEqual(m.by_rail["rapidapi-bypass"], 50);

  console.log("  ok 11: concurrency losslessness — 50 concurrent increments end at exactly 50 (F-05)");
}

// 12. audit-q3 F1 (t_2576bb7f): /internal/cdp-probe + /internal/cdp-settle-raw
//     are registered ABOVE the payment gate, so they must carry their own auth.
//     Both are gated behind RAPIDAPI_PROXY_SECRET (same constant-time compare
//     as the RapidAPI rail). Fails closed: absent header => 401, wrong secret
//     => 401, unconfigured secret => 401. The exact secret reaches the handler
//     (which 500s "CDP secrets absent" — hermetic, no network).
async function testInternalCdpEndpointsGated() {
  installFetchStub();
  const ENV = {
    ...BASE_ENV,
    CACHE: makeFakeKV(),
    RAPIDAPI_PROXY_SECRET: "rapidapi-proxy-secret-test-0123456789abcdef",
  };
  const H = { "X-RapidAPI-Proxy-Secret": ENV.RAPIDAPI_PROXY_SECRET };

  // Absent header -> 401 on both routes.
  const probeNoHeader = await app.request("/internal/cdp-probe", {}, ENV);
  assert.strictEqual(probeNoHeader.status, 401, "cdp-probe without secret header must 401");
  const settleNoHeader = await app.request(
    "/internal/cdp-settle-raw",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ENV,
  );
  assert.strictEqual(settleNoHeader.status, 401, "cdp-settle-raw without secret header must 401");

  // Wrong secret -> 401.
  const probeWrong = await app.request(
    "/internal/cdp-probe",
    { headers: { "X-RapidAPI-Proxy-Secret": "a".repeat(48) } },
    ENV,
  );
  assert.strictEqual(probeWrong.status, 401, "cdp-probe with wrong secret must 401");

  // Fails closed: no RAPIDAPI_PROXY_SECRET configured at all -> 401 even with a header.
  const noCfgEnv = { ...BASE_ENV, CACHE: makeFakeKV() };
  const probeNoCfg = await app.request("/internal/cdp-probe", { headers: H }, noCfgEnv);
  assert.strictEqual(probeNoCfg.status, 401, "no configured secret must fail closed (401)");

  // Exact secret reaches the handler. cdp-probe 500s "CDP secrets absent from
  // env" (CDP_API_KEY_ID/SECRET unset here) — proving the gate let it through.
  const probeOk = await app.request("/internal/cdp-probe", { headers: H }, ENV);
  assert.strictEqual(probeOk.status, 500, "exact secret must reach the cdp-probe handler");
  const probeBody = await probeOk.json();
  assert.strictEqual(probeBody.error, "CDP secrets absent from env", "handler-level 500 proves the gate passed");

  // Same for cdp-settle-raw: exact secret reaches the handler (500, no network).
  const settleOk = await app.request(
    "/internal/cdp-settle-raw",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...H },
      body: JSON.stringify({ paymentPayload: {}, paymentRequirements: {} }),
    },
    ENV,
  );
  assert.strictEqual(settleOk.status, 500, "exact secret must reach the cdp-settle-raw handler");
  const settleBody = await settleOk.json();
  assert.strictEqual(settleBody.error, "CDP secrets absent", "settle handler-level 500 proves the gate passed");

  console.log("  ok 12: /internal/cdp-probe + /internal/cdp-settle-raw gated behind RAPIDAPI_PROXY_SECRET (audit-q3 F1)");
}

// ---------------------------------------------------------------------------

async function main() {
  const tests = [
    testX402PaidTracksRouteRailAndTs,
    testNonChainRailsNeverTouchPaidCounters,
    testPaidSurfaceTracked,
    testMetricsAggregation,
    testNoCounterDegrades,
    testMetricsEndpointGateBypassed,
    testRapidapiBypassEndToEnd,
    testApiKeyBypassEndToEnd,
    testUnpaidMcpGatedNoTracking,
    testMetricsEndpointReadsDoCounters,
    testConcurrentIncrementsLossless,
    testInternalCdpEndpointsGated,
  ];

  console.log("test_usage.js — paid-usage accounting (atomic DO counters + /metrics)\n");
  for (const t of tests) {
    await t();
  }
  console.log(`\nAll ${tests.length} usage tests passed.`);
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exit(1);
});
