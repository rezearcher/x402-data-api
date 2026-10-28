/**
 * Badge-impression counter tests — the Line-B distribution kill-check.
 *
 * Run: node --test "tests/test_badge_impressions.mjs"
 *   (Node >= 22 strips TypeScript types from the imported .ts source.)
 *
 * Covers the same security + fail-soft contract as the funnel beacons:
 *   - a valid badge kind increments exactly badge:<kind> (by 1)
 *   - an UNLISTED kind writes NO key (bounded DO key-space, cost/row-DoS guard)
 *   - path-traversal / empty / object kinds are all dropped
 *   - getBadgeImpressionMetrics aggregates per-kind + a grand total
 *   - a missing counter binding degrades open to zeros and never throws
 */
import { test } from "node:test";
import assert from "node:assert";

const { trackBadgeImpression, getBadgeImpressionMetrics, BADGE_KINDS, isBadgeKind } =
  await import("../src/usage.ts");

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

test("enum of badge kinds is the expected bounded set", () => {
  assert.deepStrictEqual(
    [...BADGE_KINDS],
    ["security", "directory", "monitored", "ownership", "rank", "leaderboard"],
  );
  assert.strictEqual(isBadgeKind("security"), true);
  assert.strictEqual(isBadgeKind("nope"), false);
  assert.strictEqual(isBadgeKind(42), false);
});

test("valid kinds increment badge:<kind>; invalid kinds write no key", async () => {
  const counter = makeFakeCounter();
  await trackBadgeImpression("security", counter);
  await trackBadgeImpression("security", counter);
  await trackBadgeImpression("directory", counter);
  await trackBadgeImpression("rank", counter);
  await trackBadgeImpression("leaderboard", counter);
  await trackBadgeImpression("monitored", counter);
  await trackBadgeImpression("ownership", counter);
  // Unlisted / hostile kinds MUST NOT create a key (DO key-space stays bounded).
  await trackBadgeImpression("evil", counter);
  await trackBadgeImpression("../../etc/passwd", counter);
  await trackBadgeImpression("", counter);
  await trackBadgeImpression({ toString: () => "security" }, counter);

  assert.strictEqual(counter.store.get("badge:security"), 2);
  assert.strictEqual(counter.store.get("badge:directory"), 1);
  assert.strictEqual(counter.store.get("badge:rank"), 1);
  assert.strictEqual(counter.store.get("badge:leaderboard"), 1);
  assert.strictEqual(counter.store.get("badge:monitored"), 1);
  assert.strictEqual(counter.store.get("badge:ownership"), 1);

  for (const k of counter.store.keys()) {
    assert.ok(
      /^badge:(security|directory|monitored|ownership|rank|leaderboard)$/.test(k),
      `unexpected badge key written: ${k}`,
    );
  }
});

test("getBadgeImpressionMetrics aggregates per-kind plus a grand total", async () => {
  const counter = makeFakeCounter();
  await trackBadgeImpression("security", counter);
  await trackBadgeImpression("security", counter);
  await trackBadgeImpression("security", counter);
  await trackBadgeImpression("rank", counter);

  const m = await getBadgeImpressionMetrics(counter);
  assert.strictEqual(m.security, 3);
  assert.strictEqual(m.rank, 1);
  assert.strictEqual(m.directory, 0);
  assert.strictEqual(m.leaderboard, 0);
  assert.strictEqual(m.total, 4);
});

test("no counter binding => zeros everywhere, never throws", async () => {
  const empty = await getBadgeImpressionMetrics(undefined);
  for (const k of BADGE_KINDS) assert.strictEqual(empty[k], 0);
  assert.strictEqual(empty.total, 0);
  await trackBadgeImpression("security", undefined); // must not throw
});
