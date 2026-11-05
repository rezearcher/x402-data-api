/**
 * Contract test for the Open 402 Directory capability manifest.
 *
 *   node tests/test_agent_json_manifest.mjs
 *
 * WHY (measured 2026-11-04): our 5 domains are indexed in the Open 402 Directory
 * (ArcedeDev/open-402, 18,204 domains) but every row is `unclaimed` with null
 * display_name/description and 0 intents because we 404 `/.well-known/agent.json`.
 * Serving a spec-v1.4 Tier-2 ("Capable") manifest flips the rows to VERIFIED with
 * full metadata. This locks buildAgentJson against the real ROUTE_CATALOG so the
 * manifest can never drift from the routes we actually serve, and pins the fields
 * the directory crawler + validator require (version/origin/payout_address + rich
 * intents with endpoint/method/price). Node >= 22.18 strips TS on import;
 * cfw-hooks.mjs shims cloudflare:workers.
 */
import assert from "node:assert";
import { register } from "node:module";

register(new URL("./cfw-hooks.mjs", import.meta.url));

const { buildAgentJson, ROUTE_CATALOG } = await import("../src/index.ts");

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); pass++; };

const ORIGIN = "api.greyridgesignals.ai";
const PAYTO = "0x1111111111111111111111111111111111111111";
const m = buildAgentJson(ORIGIN, PAYTO);

// (1) Tier-1 required root fields, exact.
eq(m.version, "1.4", "spec version");
eq(m.origin, ORIGIN, "origin == serving host (validator requires this)");
eq(m.payout_address, PAYTO, "payout_address echoes PAY_TO");

// (2) origin varies by serving host — the workers.dev row must self-describe too.
{
  const w = buildAgentJson("x402-data-api.sigrunner.workers.dev", PAYTO);
  eq(w.origin, "x402-data-api.sigrunner.workers.dev", "origin tracks host");
  // endpoints are host-relative paths, so intents are identical across hosts.
  eq(JSON.stringify(w.intents), JSON.stringify(m.intents), "intents host-agnostic");
}

// (3) payments.x402 shape the directory reads (Object.keys(payments) → badges).
ok(m.payments && m.payments.x402, "payments.x402 present");
const net = m.payments.x402.networks[0];
eq(net.network, "base", "network label is 'base' (not CAIP) per directory schema");
eq(net.asset, "USDC", "asset USDC");
ok(/^0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913$/i.test(net.contract), "Base USDC contract");

// (3b) multi-network discovery: the manifest advertises EVERY network we can
// actually settle on (Base + the facilitator-supported extra EVM chains our same
// payTo receives native USDC on), so a routing agent on Polygon/Arbitrum sees it
// can pay here instead of bouncing off a Base-only manifest.
const nets = m.payments.x402.networks;
ok(Array.isArray(nets) && nets.length >= 3, `>=3 settlement networks advertised (got ${nets.length})`);
const labels = nets.map((n) => n.network);
ok(labels.includes("base"), "base network advertised");
ok(labels.includes("polygon"), "polygon network advertised");
ok(labels.includes("arbitrum"), "arbitrum network advertised");
for (const n of nets) {
  eq(n.asset, "USDC", `network ${n.network} settles USDC`);
  ok(/^0x[0-9a-fA-F]{40}$/.test(n.contract), `network ${n.network} has a USDC contract`);
}
// extra networks carry the correct native USDC contract (no drift from settlement)
const poly = nets.find((n) => n.network === "polygon");
ok(/^0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359$/i.test(poly.contract), "Polygon native USDC contract");
const arb = nets.find((n) => n.network === "arbitrum");
ok(/^0xaf88d065e77c8cC2239327C5EDb3A432268e5831$/i.test(arb.contract), "Arbitrum native USDC contract");

// (3c) the prepaid session-cap rail is surfaced at discovery time so a
// high-frequency poller chooses it, not discovers it only after per-call friction.
const sb = m.payments.x402.session_billing;
ok(sb && typeof sb.description === "string" && sb.description.length > 0, "session_billing present with description");
eq(sb.open_endpoint, "/x402/session", "session opener endpoint");
eq(sb.balance_check, "/x402/session/status", "free session balance check");
ok(Array.isArray(sb.tiers) && sb.tiers.length === 3, "three session tiers");
for (const t of sb.tiers) {
  ok(typeof t.endpoint === "string" && t.endpoint.startsWith("/x402/session"), `session tier endpoint: ${t.endpoint}`);
  ok(t.cap && typeof t.cap.amount === "number" && t.cap.currency === "USDC", `session tier cap {amount,USDC}: ${t.endpoint}`);
}
// caps match the SESSION_TIERS source of truth
eq(sb.tiers.find((t) => t.endpoint === "/x402/session").cap.amount, 0.05, "default cap $0.05");
eq(sb.tiers.find((t) => t.endpoint === "/x402/session/plus").cap.amount, 0.5, "plus cap $0.50");
eq(sb.tiers.find((t) => t.endpoint === "/x402/session/max").cap.amount, 5.0, "max cap $5.00");

// (3b) scheme interoperability: exact everywhere + canonical upto on the high-freq lanes.
const schemes = m.payments.x402.schemes;
ok(Array.isArray(schemes) && schemes.length >= 2, "payments.x402.schemes present (exact + upto)");
const exactS = schemes.find((s) => s.scheme === "exact");
const uptoS = schemes.find((s) => s.scheme === "upto");
ok(exactS, "exact scheme declared");
ok(uptoS && Array.isArray(uptoS.routes), "upto scheme declared with a routes list");
for (const r of ["/crypto/prices", "/crypto/funding", "/defi/yields"]) {
  ok(uptoS.routes.includes(r), `upto advertised on ${r}`);
}
ok(!uptoS.routes.some((r) => r.startsWith("GET ")), "upto route list is bare paths (no method prefix)");

// (4) intents derived from the REAL catalog, one per route, with required fields.
ok(Array.isArray(m.intents) && m.intents.length === ROUTE_CATALOG.length,
  `one intent per catalog route (got ${m.intents.length}, catalog ${ROUTE_CATALOG.length})`);
for (const it of m.intents) {
  ok(typeof it.name === "string" && it.name.length > 0, "intent has a name");
  ok(typeof it.endpoint === "string" && it.endpoint.startsWith("/"), `intent endpoint is a path: ${it.endpoint}`);
  ok(it.method === "GET" || it.method === "POST", `intent method valid: ${it.endpoint}`);
  ok(it.price && typeof it.price.amount === "number" && it.price.currency === "USDC",
    `intent price {amount:number,currency:USDC}: ${it.endpoint}`);
  ok(it.description.length <= 241, `intent description is a crawler blurb: ${it.endpoint}`);
}

// (5) the flagship gate carries its required `token` parameter in agent.json shape.
{
  const gate = m.intents.find((i) => i.endpoint === "/gate/swap");
  ok(gate, "/gate/swap intent present");
  ok(gate.parameters && gate.parameters.token && gate.parameters.token.required === true,
    "/gate/swap declares a required `token` parameter");
}

// (6) a GET route with a free preview surfaces its preview_endpoint.
{
  const prev = m.intents.find((i) => typeof i.preview_endpoint === "string");
  ok(prev && prev.preview_endpoint === `${prev.endpoint}/preview`, "preview_endpoint derived from endpoint");
}

// (7) commitments are a measurement (Claims Law), not an asserted SLA.
ok(m.commitments && Array.isArray(m.commitments.entries) && m.commitments.entries.length >= 1,
  "commitments.entries present");
ok(/measurement, not a contractual SLA/i.test(m.commitments.note), "commitments disclaim SLA");
ok(typeof m.commitments.entries[0].value === "number", "availability commitment is a real number");

// (8) whole thing round-trips as valid JSON (served Content-Type: application/json).
JSON.parse(JSON.stringify(m));
pass++;

console.log(`ok - agent.json manifest contract: ${pass} assertions`);
