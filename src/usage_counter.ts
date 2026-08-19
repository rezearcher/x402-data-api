/**
 * Atomic paid-usage counters (audit F-05, mirrored from x402-cve-triage).
 *
 * KV's read-modify-write could lose increments when two paid calls landed
 * concurrently. This Durable Object is the single writer for every usage
 * counter: the storage ops of one fetch are applied single-threaded, so
 * concurrent `apply()` batches are serialized — no lost updates. Counters are
 * durable (SQLite-backed DO storage), so the daily reconcile reads survive
 * instance eviction and re-deploys.
 *
 * Binding: `USAGE_COUNTER` (see wrangler.toml [[durable_objects.bindings]] +
 * [[migrations]] v3). One instance ("paid-usage") holds every counter.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index.ts";
import type { UsageCounterLike, UsageOp } from "./usage.ts";

const INSTANCE_NAME = "paid-usage";

async function applyOp(storage: DurableObjectStorage, op: UsageOp): Promise<void> {
  switch (op.kind) {
    case "increment": {
      const by = op.by ?? 1;
      const current = (await storage.get(op.key)) as number | undefined;
      await storage.put(op.key, (current ?? 0) + by);
      return;
    }
    case "set-if-absent": {
      const existing = await storage.get(op.key);
      if (existing === null || existing === undefined) {
        await storage.put(op.key, op.value);
      }
      return;
    }
    case "set":
      await storage.put(op.key, op.value);
      return;
  }
}

export class UsageCounter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * POST `{ ops: UsageOp[] }` — apply the batch atomically (a DO handles one
   * request at a time, so no two batches can interleave). GET — the full
   * counter snapshot for getMetrics.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const body = (await request.json()) as { ops?: UsageOp[] };
      const ops = Array.isArray(body.ops) ? body.ops : [];
      for (const op of ops) {
        await applyOp(this.ctx.storage, op);
      }
      return Response.json({ ok: true, applied: ops.length });
    }
    const entries = await this.ctx.storage.list();
    const snapshot: Record<string, string | number> = {};
    for (const [key, value] of entries) {
      snapshot[key] = value as string | number;
    }
    return Response.json(snapshot);
  }
}

/**
 * Build the usage-counter binding adapter for a request context. Returns
 * undefined when the binding is absent (local dev / tests without the
 * binding), which makes tracking no-op — same graceful degradation as the
 * sibling worker.
 */
export function makeUsageCounter(env: {
  USAGE_COUNTER?: DurableObjectNamespace<UsageCounter>;
}): UsageCounterLike | undefined {
  const ns = env.USAGE_COUNTER;
  if (!ns) return undefined;
  const stub = () => ns.get(ns.idFromName(INSTANCE_NAME));
  return {
    async apply(ops: UsageOp[]): Promise<void> {
      const res = await stub().fetch("https://usage-counter/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops }),
      });
      if (!res.ok) {
        throw new Error(`usage counter apply failed: HTTP ${res.status}`);
      }
    },
    async snapshot(): Promise<Record<string, string | number>> {
      const res = await stub().fetch("https://usage-counter/snapshot");
      return (await res.json()) as Record<string, string | number>;
    },
  };
}
