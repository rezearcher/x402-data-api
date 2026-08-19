/**
 * Paid-usage accounting for x402-data-api.
 *
 * The daily chain-verified reconcile ledger needs per-play attribution that
 * chain-side scans cannot provide (per-route, and per-rail: x402-paid vs
 * RapidAPI-bypass vs api-key credits). This module tracks that breakdown
 * worker-side as aggregate counters — mirroring the proven x402-cve-triage
 * counter (audit F-05).
 *
 * Counter storage: a Durable Object, not KV. Cloudflare KV is eventually
 * consistent and offers no atomic increment, so the old read-modify-write
 * (`kv.get` -> `kv.put(count+1)`) could lose increments when two paid calls
 * landed concurrently. All counters live in a single `UsageCounter` DO
 * instance ("paid-usage", binding `USAGE_COUNTER` in wrangler.toml, see
 * src/usage_counter.ts). A DO handles one fetch at a time, so an `apply()`
 * batch is serialized — concurrent paid calls can never drop a count — and
 * the counters are durable (SQLite-backed DO storage).
 *
 * The counter stays off the response path: `trackPaidRequest` is invoked
 * fire-and-forget via `ctx.waitUntil` and swallows its own errors, so a
 * counter outage can never break or slow a paid response.
 */

export type Route =
  // First real-demand product line (Bazaar catalog, $0.01-$0.10/call).
  | "GET /enrich/domain"
  | "GET /enrich/tech-risk"
  | "GET /scan/mcp"
  | "GET /chain/token-security"
  // Freemium long tail — also x402-gated and chain-settled, so undercounting
  // them would trip the reconcile delta. Every site that logs paid_request is
  // counted.
  | "GET /dns/:domain"
  | "GET /whois/:domain"
  | "GET /pm/markets"
  | "GET /crypto/funding"
  | "GET /defi/yields"
  | "GET /crypto/prices"
  | "GET /chain/block-number"
  | "GET /chain/gas-price"
  | "GET /chain/balance"
  | "GET /chain/token-balance"
  | "GET /chain/tx"
  | "GET /chain/receipt"
  | "GET /chain/code"
  | "GET /chain/wallet"
  | "POST /mcp";

export type Rail = "x402-paid" | "rapidapi-bypass" | "api-key";

// Counter keys (mirrored in ARCHITECTURE.md and the 08-21 attribution card).
export const ROUTE_KEY_PREFIX = "usage:paid:";
export const RAIL_KEY_PREFIX = "usage:rail:";
export const TS_FIRST_KEY = "usage:ts:first";
export const TS_LAST_KEY = "usage:ts:last";

// One atomic storage op, applied by the UsageCounter Durable Object. A whole
// trackPaidRequest is a single `apply()` batch -> one DO fetch -> no
// interleaving between the increments and the ts bookends.
export type UsageOp =
  | { kind: "increment"; key: string; by?: number }
  | { kind: "set-if-absent"; key: string; value: string }
  | { kind: "set"; key: string; value: string };

// Storage backend shape. `apply()` must be atomic across concurrent callers
// (the DO serializes batches; tests use a serialized fake).
export interface UsageCounterLike {
  apply(ops: UsageOp[]): Promise<void>;
  snapshot(): Promise<Record<string, string | number>>;
}

export interface UsageMetrics {
  total_paid_calls: number;
  by_route: Record<Route, number>;
  by_rail: Record<Rail, number>;
  first_call_ts: number | null;
  last_call_ts: number | null;
}

/**
 * Track a successful paid call, fire-and-forget.
 *
 * The caller decides what counts as "successful" (gate passed AND the route
 * handler produced its result). We never throw: a counter outage must not
 * fail a paid request. `rail` is set by the gate middleware (see index.ts).
 *
 * Guardrail (F-01, extended for the third rail): non-chain rails —
 * rapidapi-bypass (RapidAPI already collected from the buyer) and api-key
 * (prepaid Stripe credits) — only bump `usage:rail:<rail>`, NEVER
 * `usage:paid:<route>` or the ts bookends. Only x402-paid calls settle
 * USDC on Base, so only they may count as paid, keeping the chain-verified
 * reconcile delta exact.
 */
export async function trackPaidRequest(
  route: Route,
  rail: Rail,
  counter: UsageCounterLike | undefined,
): Promise<void> {
  if (!counter) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    const ops: UsageOp[] = [{ kind: "increment", key: RAIL_KEY_PREFIX + rail }];
    if (rail === "x402-paid") {
      ops.push({ kind: "increment", key: ROUTE_KEY_PREFIX + route });
      ops.push({ kind: "set-if-absent", key: TS_FIRST_KEY, value: String(now) });
      ops.push({ kind: "set", key: TS_LAST_KEY, value: String(now) });
    }
    await counter.apply(ops);
  } catch (error) {
    console.error("Error tracking paid usage:", error);
  }
}

const ALL_ROUTES: Route[] = [
  "GET /enrich/domain",
  "GET /enrich/tech-risk",
  "GET /scan/mcp",
  "GET /chain/token-security",
  "GET /dns/:domain",
  "GET /whois/:domain",
  "GET /pm/markets",
  "GET /crypto/funding",
  "GET /defi/yields",
  "GET /crypto/prices",
  "GET /chain/block-number",
  "GET /chain/gas-price",
  "GET /chain/balance",
  "GET /chain/token-balance",
  "GET /chain/tx",
  "GET /chain/receipt",
  "GET /chain/code",
  "GET /chain/wallet",
  "POST /mcp",
];
const ALL_RAILS: Rail[] = ["x402-paid", "rapidapi-bypass", "api-key"];

/** Coerce a snapshot value (number from the DO, numeric string from old KV rows) to a count. */
function toNumber(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (value === undefined || value === null) return 0;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aggregate the counter snapshot into the /metrics shape. Gate-bypassed
 * endpoint — aggregate-only, no per-request data, no PAY_TO, no keys.
 */
export async function getMetrics(
  counter: UsageCounterLike | undefined,
): Promise<UsageMetrics> {
  const metrics: UsageMetrics = {
    total_paid_calls: 0,
    by_route: Object.fromEntries(ALL_ROUTES.map((r) => [r, 0])) as Record<Route, number>,
    by_rail: Object.fromEntries(ALL_RAILS.map((r) => [r, 0])) as Record<Rail, number>,
    first_call_ts: null,
    last_call_ts: null,
  };
  if (!counter) return metrics;
  try {
    const snap = await counter.snapshot();
    for (const route of ALL_ROUTES) {
      const count = toNumber(snap[ROUTE_KEY_PREFIX + route]);
      metrics.by_route[route] = count;
      metrics.total_paid_calls += count;
    }
    for (const rail of ALL_RAILS) {
      metrics.by_rail[rail] = toNumber(snap[RAIL_KEY_PREFIX + rail]);
    }
    const first = toNumber(snap[TS_FIRST_KEY]);
    const last = toNumber(snap[TS_LAST_KEY]);
    metrics.first_call_ts = first > 0 ? first : null;
    metrics.last_call_ts = last > 0 ? last : null;
  } catch (error) {
    console.error("Error fetching usage metrics:", error);
  }
  return metrics;
}
