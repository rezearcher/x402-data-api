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
  | "POST /scan/mcp"
  | "GET /chain/token-security"
  | "GET /chain/token-report"
  | "GET /gate/swap"
  // Freemium long tail — also x402-gated and chain-settled, so undercounting
  // them would trip the reconcile delta. Every site that logs paid_request is
  // counted.
  | "GET /dns"
  | "GET /whois"
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
  | "GET /chain/erc20-meta"
  | "GET /chain/nonce"
  | "GET /chain/fee-estimate"
  | "GET /chain/network-status"
  | "GET /chain/l1-base-fee"
  | "GET /chain/fee-history"
  | "GET /chain/blob-base-fee"
  | "GET /chain/eth-usd"
  | "GET /chain/btc-usd"
  | "GET /chain/prices"
  | "GET /chain/sol-usd"
  | "GET /chain/link-usd"
  | "GET /chain/total-supply"
  | "GET /chain/is-contract"
  | "GET /chain/storage-at"
  | "GET /chain/proxy-info"
  | "GET /chain/allowance"
  | "GET /chain/block"
  | "GET /ai/ask"
  | "POST /v1/chat/completions"
  | "GET /ai/extract"
  | "GET /ai/translate"
  | "GET /ai/summarize"
  | "GET /ai/classify"
  | "GET /crypto/fear-greed"
  | "GET /crypto/trending"
  | "GET /defi/fees-top"
  | "GET /crypto/global"
  | "GET /crypto/markets-top"
  | "GET /crypto/movers"
  | "GET /brief/market"
  | "GET /crypto/exchanges-top"
  | "GET /crypto/categories"
  | "GET /defi/hacks-recent"
  | "GET /crypto/derivatives-exchanges"
  | "GET /defi/protocol-risk"
  | "GET /defi/safe-yields"
  | "GET /defi/yields-top"
  | "GET /defi/protocols-top"
  | "GET /defi/dex-volume"
  | "GET /defi/chains-tvl"
  | "GET /crypto/stablecoins"
  | "GET /chain/wallet"
  | "POST /mcp";

export type Rail = "x402-paid" | "rapidapi-bypass" | "api-key" | "x402-browser-unlock";

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
  /**
   * True when the counter read threw (e.g. CF free-tier DO budget exhausted) and
   * the zeros above are a fail-soft placeholder, NOT a genuine zero. Callers must
   * NOT long-cache a degraded snapshot (it would pin bogus zeros on the public
   * trust surface for the whole TTL). Absent/false => the numbers are real.
   */
  degraded?: boolean;
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
  // Workers Logs line survives a Durable Object outage; one JSON line per paid call.
  console.log(JSON.stringify({ evt: "paid_call", route, rail, ts: Math.floor(Date.now() / 1000) }));
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
  "POST /scan/mcp",
  "GET /chain/token-security",
  "GET /chain/token-report",
  "GET /gate/swap",
  "GET /dns",
  "GET /whois",
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
  "GET /chain/erc20-meta",
  "GET /chain/nonce",
  "GET /chain/fee-estimate",
  "GET /chain/network-status",
  "GET /chain/l1-base-fee",
  "GET /chain/fee-history",
  "GET /chain/blob-base-fee",
  "GET /chain/eth-usd",
  "GET /chain/btc-usd",
  "GET /chain/prices",
  "GET /chain/sol-usd",
  "GET /chain/link-usd",
  "GET /chain/total-supply",
  "GET /chain/is-contract",
  "GET /chain/storage-at",
  "GET /chain/proxy-info",
  "GET /chain/allowance",
  "GET /chain/block",
  "GET /ai/ask",
  "POST /v1/chat/completions",
  "GET /ai/extract",
  "GET /ai/translate",
  "GET /ai/summarize",
  "GET /ai/classify",
  "GET /crypto/fear-greed",
  "GET /crypto/trending",
  "GET /defi/fees-top",
  "GET /defi/protocols-top",
  "GET /defi/dex-volume",
  "GET /defi/chains-tvl",
  "GET /crypto/stablecoins",
  "GET /chain/wallet",
  "POST /mcp",
];
const ALL_RAILS: Rail[] = ["x402-paid", "rapidapi-bypass", "api-key", "x402-browser-unlock"];

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
    // The zeros above are a fail-soft placeholder, not a genuine zero. Flag it so
    // the /metrics handler does not pin this bogus snapshot for the full edge TTL.
    metrics.degraded = true;
  }
  return metrics;
}

// ---------------------------------------------------------------------------
// Human-page funnel beacons.
//
// The server-side counters above record SETTLED paid calls, but the human pay
// path (/check, /miniapp) is otherwise blind: we cannot tell whether nobody
// views the page or everybody views it and abandons at wallet-connect. These
// aggregate, no-PII beacons measure the drop between stages so the revenue
// goal-gate reads a real leak instead of guessing. Same DO, same fail-soft
// contract as trackPaidRequest.
//
// SECURITY: the surface/event strings become DO storage keys, so they are
// strictly validated against the fixed enums below BEFORE any write — an
// attacker cannot inflate an unbounded key space (a cost/row DoS on the shared
// counter). Unknown values are dropped (the page still renders; the beacon is
// fire-and-forget). Config, not a behavioural gate: adding a surface/event is a
// one-line enum edit, and an unlisted value degrades open to "not counted".
// ---------------------------------------------------------------------------

export const FUNNEL_KEY_PREFIX = "funnel:";

export const FUNNEL_SURFACES = ["check", "miniapp", "tg"] as const;
export const FUNNEL_EVENTS = ["view", "unlock_click", "wallet_open", "tx_submit"] as const;
export type FunnelSurface = (typeof FUNNEL_SURFACES)[number];
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export function isFunnelSurface(v: unknown): v is FunnelSurface {
  return typeof v === "string" && (FUNNEL_SURFACES as readonly string[]).includes(v);
}
export function isFunnelEvent(v: unknown): v is FunnelEvent {
  return typeof v === "string" && (FUNNEL_EVENTS as readonly string[]).includes(v);
}

/**
 * Record one page-funnel event, fire-and-forget. Caller SHOULD pre-validate
 * (to return 204 vs 400); this re-validates as defense-in-depth so no unchecked
 * caller can ever write an arbitrary key. Never throws.
 */
export async function trackFunnelEvent(
  surface: string,
  event: string,
  counter: UsageCounterLike | undefined,
): Promise<void> {
  if (!isFunnelSurface(surface) || !isFunnelEvent(event)) return;
  if (!counter) return;
  try {
    await counter.apply([
      { kind: "increment", key: `${FUNNEL_KEY_PREFIX}${surface}:${event}` },
    ]);
  } catch (error) {
    console.error("Error tracking funnel event:", error);
  }
}

export type FunnelMetrics = Record<FunnelSurface, Record<FunnelEvent, number>>;

/** Aggregate the funnel beacon counters into a surface -> event -> count map. */
export async function getFunnelMetrics(
  counter: UsageCounterLike | undefined,
): Promise<FunnelMetrics> {
  const out = Object.fromEntries(
    FUNNEL_SURFACES.map((s) => [s, Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0]))]),
  ) as FunnelMetrics;
  if (!counter) return out;
  try {
    const snap = await counter.snapshot();
    for (const s of FUNNEL_SURFACES) {
      for (const e of FUNNEL_EVENTS) {
        out[s][e] = toNumber(snap[`${FUNNEL_KEY_PREFIX}${s}:${e}`]);
      }
    }
  } catch (error) {
    console.error("Error fetching funnel metrics:", error);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Line-B fiat (Stripe) settled-revenue oracle (Phase-0 instrument).
//
// Same discipline as the funnel beacons above: a bounded enum of event kinds
// (unlisted degrades open to "not counted"), fire-and-forget, never throws.
// Two keys per event — a count and an accumulated cents total — so /metrics can
// surface both the number of settled payments and the gross dollars, making a
// real fiat subscription dollar loop-readable (mirroring Line A's latest.json).
//
// Idempotency lives at the CALL SITE (webhook dedups by Stripe session/invoice
// id before bumping), not here — so a Stripe retry never inflates revenue.
// ---------------------------------------------------------------------------

export const FIAT_KEY_PREFIX = "fiat:";

// checkout_paid = first payment at signup; invoice_paid = recurring renewal
// (the REPEAT dollar — checkout.session.completed never fires on a renewal).
export const FIAT_EVENTS = ["checkout_paid", "invoice_paid"] as const;
export type FiatEvent = (typeof FIAT_EVENTS)[number];

export function isFiatEvent(v: unknown): v is FiatEvent {
  return typeof v === "string" && (FIAT_EVENTS as readonly string[]).includes(v);
}

/**
 * Record one settled Stripe payment, fire-and-forget. Enum-validates the event
 * FIRST (an unlisted event degrades open = not counted, no arbitrary key). The
 * caller is responsible for idempotency (dedup by Stripe id) BEFORE calling, so
 * this only ever runs once per real settlement. Never throws.
 */
export async function recordFiatSettlement(
  counter: UsageCounterLike | undefined,
  event: string,
  amountCents: number,
): Promise<void> {
  if (!isFiatEvent(event)) return;
  if (!counter) return;
  const cents = Number.isFinite(amountCents) && amountCents > 0 ? Math.round(amountCents) : 0;
  // Workers Logs line survives a DO outage — one JSON line per settlement.
  console.log(JSON.stringify({ evt: "fiat_settlement", event, cents, ts: Math.floor(Date.now() / 1000) }));
  try {
    await counter.apply([
      { kind: "increment", key: `${FIAT_KEY_PREFIX}count:${event}` },
      { kind: "increment", key: `${FIAT_KEY_PREFIX}cents:${event}`, by: cents },
    ]);
  } catch (error) {
    console.error("Error recording fiat settlement:", error);
  }
}

export type FiatEventMetric = { count: number; gross_usd: number };
export type FiatMetrics = Record<FiatEvent, FiatEventMetric> & { total_gross_usd: number };

/** Aggregate the fiat settlement counters into a per-event + total gross map. */
export async function getFiatMetrics(
  counter: UsageCounterLike | undefined,
): Promise<FiatMetrics> {
  const out: FiatMetrics = {
    checkout_paid: { count: 0, gross_usd: 0 },
    invoice_paid: { count: 0, gross_usd: 0 },
    total_gross_usd: 0,
  };
  if (!counter) return out;
  try {
    const snap = await counter.snapshot();
    let totalCents = 0;
    for (const e of FIAT_EVENTS) {
      const cents = toNumber(snap[`${FIAT_KEY_PREFIX}cents:${e}`]);
      out[e] = {
        count: toNumber(snap[`${FIAT_KEY_PREFIX}count:${e}`]),
        gross_usd: Math.round(cents) / 100,
      };
      totalCents += cents;
    }
    out.total_gross_usd = Math.round(totalCents) / 100;
  } catch (error) {
    console.error("Error fetching fiat metrics:", error);
  }
  return out;
}
