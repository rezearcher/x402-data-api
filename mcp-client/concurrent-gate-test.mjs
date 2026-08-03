#!/usr/bin/env node
/**
 * Concurrent gate test — 10 parallel requests on a 5-credit key.
 * Expect: exactly 5x HTTP 200, exactly 5x HTTP 402, then balance exhausted (6th req = 402).
 *
 * Reads the real key in-process from the miniflare KV sqlite (never prints it),
 * re-seeds via the wrangler CLI if no unexpired key exists.
 */
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const BASE = "http://localhost:8787";
const KV_DIR = ".wrangler/state/v3/kv/b4862216375341f18f2aa6d58822c874";
const DO_DIR = ".wrangler/state/v3/do/x402-data-api-CreditLedger";

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function readKvRecords() {
  const sqlite = walk(KV_DIR).find((f) => f.endsWith("metadata.sqlite"));
  if (!sqlite) return [];
  const db = new DatabaseSync(sqlite, { readOnly: true });
  const rows = db.prepare("SELECT key, blob_id FROM _mf_entries").all();
  const recs = [];
  for (const r of rows) {
    const candidates = walk(KV_DIR).filter(
      (f) => f.includes(r.blob_id) && !f.endsWith("metadata.sqlite")
    );
    let data = null;
    for (const f of candidates) {
      try {
        data = JSON.parse(readFileSync(f, "utf8"));
        if (data.key) break;
      } catch {}
    }
    if (data) recs.push({ kvKey: r.key, ...data });
  }
  db.close();
  return recs;
}

// ── pick an unexpired key, or re-seed ────────────────────────────────────────
let rec = readKvRecords().find(
  (r) => r.credits_remaining > 0 && r.expires_at > Date.now()
);

if (!rec) {
  const key = "sk_" + randomBytes(20).toString("hex"); // 43 chars
  const record = {
    key,
    stripe_session_id: "cs_test_concurrent",
    credits_remaining: 5,
    created_at: Date.now(),
    expires_at: Date.now() + 3600_000,
  };
  execSync(
    `wrangler kv key put --binding=API_KEYS --local '${key}' '${JSON.stringify(record)}'`,
    { stdio: "pipe" }
  );
  console.log("re-seeded fresh key sk_" + key.slice(3, 9) + "… (5 credits, 1h expiry)");
  rec = { kvKey: key, ...record };
} else {
  console.log(
    "using existing key sk_" + rec.kvKey.slice(3, 9) + "… credits:",
    rec.credits_remaining
  );
}

// ── health ───────────────────────────────────────────────────────────────────
try {
  const health = await fetch(BASE + "/health");
  console.log("health:", health.status);
} catch (e) {
  console.log("SERVER NOT REACHABLE:", e.message);
  process.exit(2);
}

// ── fire 10 parallel requests ────────────────────────────────────────────────
const statuses = await Promise.all(
  Array.from({ length: 10 }, () =>
    fetch(`${BASE}/dns/example.com?api_key=${encodeURIComponent(rec.kvKey)}`).then(
      (r) => r.status
    )
  )
);
const hist = {};
for (const s of statuses) hist[s] = (hist[s] ?? 0) + 1;
console.log("statuses:", JSON.stringify(hist));

// ── balance-exhaustion proof: one more request must be 402 ───────────────────
const extra = await fetch(
  `${BASE}/dns/example.com?api_key=${encodeURIComponent(rec.kvKey)}`
).then((r) => r.status);
console.log("6th request status (expect 402):", extra);

// ── DO storage state ─────────────────────────────────────────────────────────
for (const f of walk(DO_DIR).filter((x) => x.endsWith(".sqlite"))) {
  try {
    const db = new DatabaseSync(f, { readOnly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((t) => t.name);
    for (const t of tables) {
      if (t.startsWith("_cf_")) continue;
      const rows = db.prepare(`SELECT * FROM "${t}"`).all();
      console.log(`DO ${t}:`, JSON.stringify(rows));
    }
    db.close();
  } catch (e) {
    console.log("DO sqlite error:", e.message);
  }
}

// ── KV record post-test ──────────────────────────────────────────────────────
const after = readKvRecords().find((r) => r.kvKey === rec.kvKey);
console.log(
  "KV record post-test — credits_remaining:",
  after?.credits_remaining,
  "| expires_at:",
  after?.expires_at
);

const pass =
  (hist[200] ?? 0) === 5 && (hist[402] ?? 0) === 5 && extra === 402;
console.log(pass ? "VERDICT: PASS (5x200 / 5x402, balance exhausted)" : "VERDICT: FAIL");
process.exit(pass ? 0 : 1);
