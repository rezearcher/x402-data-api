/**
 * Seller-side deep verified badge (/x402/badge) — regression guard.
 *
 *   node tests/test_x402_badge.mjs
 *
 * Locks TWO things:
 *  1. The shields.io mapping (x402BadgeShields): AVOID->red, CAUTION->yellow,
 *     PAY->brightgreen, and the DEPTH signal in the message (6/6 => "deep-verified",
 *     partial => "N/6 depth"). This is the differentiator vs a liveness-only badge.
 *  2. The live endpoint contract: /x402/badge with no url returns a valid shields
 *     endpoint schema (never a 500), and detail=1 returns the embed recipe. These
 *     are deterministic (no network) so they are safe in CI.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const mod = await import("../src/index.ts");
const { default: app, x402BadgeShields, x402BadgeTiers } = mod;

// ---- fixtures: minimal PreflightResult shapes -----------------------------
const base = {
  url: "https://seller.example/data",
  checks: [{ name: "payTo_safety", ok: true, detail: "", fix: null }],
  findings: [],
  latency_ms: 10,
  scope_note: "x",
  checked_at: new Date().toISOString(),
};
function result(over) { return { ...base, ...over }; }

// PAY, every depth tier green -> brightgreen + "deep-verified"
const payFull = result({
  verdict: "PAY", will_settle: true,
  liveness: { label: "LIVE" },
  reliability: { stable: true },
  price_accuracy: { verdict: "MATCH" },
  delivery: { verdict: "SPECIFIED" },
});
let b = x402BadgeShields(payFull);
assert.equal(b.color, "brightgreen", "PAY full -> brightgreen");
assert.ok(/deep-verified/.test(b.message), `6/6 -> deep-verified, got "${b.message}"`);
assert.equal(Object.values(x402BadgeTiers(payFull)).filter(Boolean).length, 6, "all 6 tiers pass");

// PAY but delivery only UNVERIFIED + no price match -> still green but partial depth
const payPartial = result({
  verdict: "PAY", will_settle: true,
  liveness: { label: "LIVE" },
  reliability: { stable: true },
  price_accuracy: { verdict: "UNDERCHARGE" },
  delivery: { verdict: "UNVERIFIED" },
});
b = x402BadgeShields(payPartial);
assert.equal(b.color, "brightgreen", "PAY partial -> green");
assert.ok(/\/6 depth/.test(b.message), `partial -> N/6 depth, got "${b.message}"`);
assert.ok(!/deep-verified/.test(b.message), "partial must NOT claim deep-verified");

// CAUTION, zombie -> yellow "zombie"
const caution = result({
  verdict: "CAUTION", will_settle: false,
  liveness: { label: "ZOMBIE" },
});
b = x402BadgeShields(caution);
assert.equal(b.color, "yellow", "CAUTION -> yellow");
assert.equal(b.message, "zombie", `zombie liveness surfaced, got "${b.message}"`);

// AVOID, price trap -> red "price trap"
const avoidTrap = result({
  verdict: "AVOID", will_settle: false,
  liveness: { label: "LIVE" },
  price_trap: { flagged: true, tier: "extreme" },
});
b = x402BadgeShields(avoidTrap);
assert.equal(b.color, "red", "AVOID -> red");
assert.equal(b.message, "price trap", `price trap surfaced, got "${b.message}"`);

// AVOID, dead endpoint -> red "dead"
const avoidDead = result({
  verdict: "AVOID", will_settle: false,
  liveness: { label: "DEAD" },
  checks: [{ name: "payTo_safety", ok: false, detail: "", fix: null }],
});
b = x402BadgeShields(avoidDead);
assert.equal(b.color, "red");
assert.equal(b.message, "dead", `dead surfaced, got "${b.message}"`);

// AVOID, payable challenge present but payTo failed OFAC/scam screen -> "unsafe payTo"
const avoidUnsafePayto = result({
  verdict: "AVOID", will_settle: true,
  liveness: { label: "LIVE" },
  checks: [{ name: "payTo_safety", ok: false, detail: "sanctioned", fix: null }],
});
assert.equal(x402BadgeShields(avoidUnsafePayto).message, "unsafe payTo");

// AVOID, NOT an x402 endpoint (no valid 402 challenge, payTo absent) -> must say
// "no valid 402", NOT falsely accuse the payTo. Regression for the live example.com case.
const avoidNo402 = result({
  verdict: "AVOID", will_settle: false,
  liveness: { label: "ZOMBIE" },
  checks: [{ name: "payTo_safety", ok: false, detail: "no payTo in challenge", fix: null }],
});
assert.equal(x402BadgeShields(avoidNo402).message, "no valid 402", "missing challenge must not read 'unsafe payTo'");

// ---- live contract: no url is a valid shields badge, never 500 -----------
let res = await app.request("/x402/badge", {}, {});
assert.equal(res.status, 200, "no-url badge is 200");
let j = await res.json();
assert.equal(j.schemaVersion, 1, "shields schemaVersion");
assert.equal(j.color, "lightgrey", "no-url -> grey");
assert.ok(typeof j.message === "string");

// detail=1 no url -> embed recipe
res = await app.request("/x402/badge?detail=1", {}, {});
assert.equal(res.status, 200);
j = await res.json();
assert.ok(/img\.shields\.io\/endpoint/.test(j.embed_markdown), "embed recipe present");
assert.ok(Array.isArray(j.tiers) && j.tiers.length === 6, "6 tiers advertised");

// badge route must NOT be x402-gated (free to render, like the proven model)
res = await app.request("/x402/badge?url=not-a-url&detail=1", {}, {});
assert.notEqual(res.status, 402, "badge must be free, never 402");

console.log("ok - test_x402_badge: shields mapping + depth tiers + free render contract locked");
